import type { DB } from '../db.js';
import { SpotifyClient, SpotifyApiError } from '../spotify/client.js';
import { createdPlaylistSchema, snapshotSchema } from '../spotify/schemas.js';
import { noPremium, noActiveDevice } from '../errors.js';

/** Bis zu dieser Länge wird direkt per URI-Liste abgespielt (Weg B). */
export const DIRECT_URI_LIMIT = 90;
/** PUT/POST /playlists/{id}/items akzeptieren höchstens 100 URIs pro Request. */
const CHUNK_SIZE = 100;

export type PlaybackMode = 'auto' | 'shadow' | 'uris';

export interface PlaybackResult {
  mode: 'shadow' | 'uris';
  shadowPlaylistId?: string;
}

function toUris(trackIds: string[]): string[] {
  return trackIds.map((id) => `spotify:track:${id}`);
}

/** Übersetzt Player-Fehler in verständliche Meldungen (403 = kein Premium, 404 = kein Gerät). */
function mapPlayerError(err: unknown): never {
  if (err instanceof SpotifyApiError) {
    if (err.status === 403) throw noPremium();
    if (err.status === 404) throw noActiveDevice();
  }
  throw err;
}

async function ensureShadowPlaylist(
  db: DB,
  spotify: SpotifyClient,
  playlistId: string,
  originalName: string,
): Promise<string> {
  const row = db
    .prepare('SELECT shadow_playlist_id FROM shadow_playlists WHERE playlist_id = ?')
    .get(playlistId) as { shadow_playlist_id: string } | undefined;
  if (row) {
    // Prüfen, ob die Playlist noch existiert (könnte manuell gelöscht worden sein).
    try {
      await spotify.request(`/playlists/${row.shadow_playlist_id}`, { query: { fields: 'id' } });
      return row.shadow_playlist_id;
    } catch (err) {
      if (!(err instanceof SpotifyApiError && (err.status === 404 || err.status === 403))) throw err;
      db.prepare('DELETE FROM shadow_playlists WHERE playlist_id = ?').run(playlistId);
    }
  }
  const created = await spotify.requestParsed(createdPlaylistSchema, '/me/playlists', {
    method: 'POST',
    body: {
      name: `🔀 ${originalName} (Blockshuffle)`,
      public: false,
      description: 'Automatisch verwaltet von Spotify Blockshuffle – Reihenfolge nicht manuell ändern.',
    },
  });
  db.prepare(
    `INSERT INTO shadow_playlists (playlist_id, shadow_playlist_id) VALUES (?, ?)
     ON CONFLICT(playlist_id) DO UPDATE SET shadow_playlist_id = excluded.shadow_playlist_id`,
  ).run(playlistId, created.id);
  return created.id;
}

async function replaceShadowItems(spotify: SpotifyClient, shadowId: string, uris: string[]): Promise<void> {
  // Erste 100 ersetzen den kompletten Inhalt, der Rest wird in 100er-Blöcken angehängt.
  const first = uris.slice(0, CHUNK_SIZE);
  await spotify.requestParsed(snapshotSchema, `/playlists/${shadowId}/items`, {
    method: 'PUT',
    body: { uris: first },
  });
  for (let i = CHUNK_SIZE; i < uris.length; i += CHUNK_SIZE) {
    await spotify.requestParsed(snapshotSchema, `/playlists/${shadowId}/items`, {
      method: 'POST',
      body: { uris: uris.slice(i, i + CHUNK_SIZE) },
    });
  }
}

export async function startPlayback(
  db: DB,
  spotify: SpotifyClient,
  args: {
    playlistId: string;
    playlistName: string;
    trackIds: string[];
    deviceId?: string;
    mode?: PlaybackMode;
  },
): Promise<PlaybackResult> {
  const { trackIds } = args;
  const mode: 'shadow' | 'uris' =
    args.mode === 'shadow' || args.mode === 'uris'
      ? args.mode
      : trackIds.length <= DIRECT_URI_LIMIT
        ? 'uris'
        : 'shadow';

  const deviceQuery = args.deviceId ? { device_id: args.deviceId } : {};

  if (mode === 'shadow') {
    const shadowId = await ensureShadowPlaylist(db, spotify, args.playlistId, args.playlistName);
    await replaceShadowItems(spotify, shadowId, toUris(trackIds));
    try {
      // Zwingend: sonst würfelt Spotify die berechnete Reihenfolge wieder durcheinander.
      await spotify.request('/me/player/shuffle', { method: 'PUT', query: { state: false, ...deviceQuery } });
      await spotify.request('/me/player/play', {
        method: 'PUT',
        query: deviceQuery,
        body: { context_uri: `spotify:playlist:${shadowId}`, offset: { position: 0 }, position_ms: 0 },
      });
    } catch (err) {
      mapPlayerError(err);
    }
    return { mode, shadowPlaylistId: shadowId };
  }

  try {
    await spotify.request('/me/player/shuffle', { method: 'PUT', query: { state: false, ...deviceQuery } });
    await spotify.request('/me/player/play', {
      method: 'PUT',
      query: deviceQuery,
      body: { uris: toUris(trackIds), position_ms: 0 },
    });
  } catch (err) {
    mapPlayerError(err);
  }
  return { mode };
}
