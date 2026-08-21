import { z } from 'zod';
import type { DB } from '../db.js';
import { SpotifyClient, SpotifyApiError } from '../spotify/client.js';
import { createdPlaylistSchema, snapshotSchema, devicesResponseSchema } from '../spotify/schemas.js';
import { ApiError, noPremium, noActiveDevice } from '../errors.js';

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

/**
 * Übersetzt Player-Fehler in verständliche Meldungen. 403 heißt nur bei
 * reason=PREMIUM_REQUIRED wirklich "kein Premium" — sonst ist es eine
 * Player-Restriktion (z. B. Kommando an ein Gerät ohne laufende Wiedergabe).
 */
export function mapPlayerError(err: unknown): never {
  if (err instanceof SpotifyApiError) {
    if (err.status === 403) {
      if (err.reason === 'PREMIUM_REQUIRED') throw noPremium();
      throw new ApiError(
        409,
        'player_restriction',
        `Spotify lehnt das Player-Kommando ab (${err.reason ?? 'Einschränkung'}). Meist hilft: In der Spotify-App auf dem Zielgerät kurz Play/Pause tippen und es erneut versuchen.`,
      );
    }
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

  let shadowId: string | undefined;
  let playBody: Record<string, unknown>;
  if (mode === 'shadow') {
    shadowId = await ensureShadowPlaylist(db, spotify, args.playlistId, args.playlistName);
    await replaceShadowItems(spotify, shadowId, toUris(trackIds));
    // Der Playback-Dienst hängt dem Playlist-Update teils ein paar Sekunden
    // hinterher: erst prüfen, dass der neue Stand lesbar ist, und den Start
    // über die URI des ersten Tracks statt über Position 0 setzen — sonst
    // spielt zuerst noch der alte erste Track.
    await waitForShadowUpdate(spotify, shadowId, trackIds[0]!);
    playBody = {
      context_uri: `spotify:playlist:${shadowId}`,
      offset: { uri: `spotify:track:${trackIds[0]!}` },
      position_ms: 0,
    };
  } else {
    playBody = { uris: toUris(trackIds), position_ms: 0 };
  }

  try {
    await issuePlayerCommands(spotify, args.deviceId, playBody);
  } catch (err) {
    // Kein aktives Gerät und keins explizit gewählt: aufs aktive bzw. einzige
    // bekannte Gerät ausweichen (deckt "Spotify ist offen, aber idle" ab).
    if (err instanceof SpotifyApiError && err.status === 404 && !args.deviceId) {
      const fallbackId = await findFallbackDevice(spotify);
      if (fallbackId) {
        try {
          await issuePlayerCommands(spotify, fallbackId, playBody);
          return { mode, shadowPlaylistId: shadowId };
        } catch (err2) {
          mapPlayerError(err2);
        }
      }
    }
    mapPlayerError(err);
  }
  return { mode, shadowPlaylistId: shadowId };
}

async function issuePlayerCommands(
  spotify: SpotifyClient,
  deviceId: string | undefined,
  playBody: Record<string, unknown>,
): Promise<void> {
  const deviceQuery = deviceId ? { device_id: deviceId } : {};
  if (deviceId) {
    // Ein explizit gewähltes, aber inaktives Gerät beantwortet Player-Kommandos
    // mit 404 — deshalb zuerst die Wiedergabe dorthin übertragen.
    await spotify.request('/me/player', {
      method: 'PUT',
      body: { device_ids: [deviceId], play: false },
    });
  }
  // Zwingend: sonst würfelt Spotify die berechnete Reihenfolge wieder durcheinander.
  // Geräte ohne laufende Wiedergabe lehnen das Kommando teils mit 403/404 ab —
  // dann nach dem Play erneut versuchen.
  const shuffleOff = () =>
    spotify.request('/me/player/shuffle', { method: 'PUT', query: { state: false, ...deviceQuery } });
  try {
    await shuffleOff();
  } catch (err) {
    if (!(err instanceof SpotifyApiError && (err.status === 403 || err.status === 404))) throw err;
  }
  await spotify.request('/me/player/play', { method: 'PUT', query: deviceQuery, body: playBody });
  try {
    await shuffleOff();
  } catch {
    // Bleibt Shuffle an, warnt die Statusleiste.
  }
}

const shadowFirstItemSchema = z.object({
  items: z.array(z.object({ item: z.object({ id: z.string().nullable() }).nullable() })),
});

/** Wartet (best effort), bis die Shadow-Playlist den neuen ersten Track meldet. */
async function waitForShadowUpdate(
  spotify: SpotifyClient,
  shadowId: string,
  expectedFirstTrackId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const page = await spotify.requestParsed(shadowFirstItemSchema, `/playlists/${shadowId}/items`, {
        query: { limit: 1, fields: 'items(item(id))' },
      });
      if (page.items[0]?.item?.id === expectedFirstTrackId) return;
    } catch {
      // kurz warten und erneut versuchen
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function findFallbackDevice(spotify: SpotifyClient): Promise<string | null> {
  try {
    const res = await spotify.requestParsed(devicesResponseSchema, '/me/player/devices');
    const devices = res.devices.filter((d) => d.id !== null && !d.is_restricted);
    const candidate = devices.find((d) => d.is_active) ?? (devices.length === 1 ? devices[0] : undefined);
    return candidate?.id ?? null;
  } catch {
    return null;
  }
}
