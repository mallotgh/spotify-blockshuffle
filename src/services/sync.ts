import type { DB } from '../db.js';
import { SpotifyClient, SpotifyApiError } from '../spotify/client.js';
import {
  playlistPageSchema,
  playlistItemsPageSchema,
  playlistMetaSchema,
  type SpotifyTrack,
} from '../spotify/schemas.js';

/** Seit Februar 2026 erlaubt GET /playlists/{id}/items höchstens limit=50. */
const ITEMS_PAGE_LIMIT = 50;
const PLAYLISTS_PAGE_LIMIT = 50;

export interface PlaylistRow {
  id: string;
  name: string;
  owner_id: string;
  snapshot_id: string | null;
  image_url: string | null;
  track_total: number;
  items_readable: number;
  stale: number;
  last_synced_at: number | null;
}

/** Lädt alle Playlists des Nutzers (paginiert) und persistiert sie. */
export async function syncPlaylists(db: DB, spotify: SpotifyClient): Promise<void> {
  const upsert = db.prepare(
    `INSERT INTO playlists (id, name, owner_id, snapshot_id, image_url, track_total, stale)
     VALUES (@id, @name, @owner_id, @snapshot_id, @image_url, @track_total, 0)
     ON CONFLICT(id) DO UPDATE SET
       name = @name, owner_id = @owner_id, image_url = @image_url,
       track_total = @track_total, stale = 0`,
  );
  const seen = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await spotify.requestParsed(playlistPageSchema, '/me/playlists', {
      query: { limit: PLAYLISTS_PAGE_LIMIT, offset },
    });
    db.transaction(() => {
      for (const pl of page.items) {
        if (!pl) continue;
        seen.add(pl.id);
        upsert.run({
          id: pl.id,
          name: pl.name,
          owner_id: pl.owner.id,
          snapshot_id: pl.snapshot_id ?? null,
          image_url: pl.images?.[0]?.url ?? null,
          track_total: pl.items?.total ?? 0,
        });
      }
    })();
    if (!page.next) break;
    offset += PLAYLISTS_PAGE_LIMIT;
  }
  // Nicht mehr vorhandene Playlists nur markieren — Blöcke bleiben erhalten.
  const ids = [...seen];
  const placeholders = ids.map(() => '?').join(',');
  if (ids.length > 0) {
    db.prepare(`UPDATE playlists SET stale = 1 WHERE id NOT IN (${placeholders})`).run(...ids);
  } else {
    db.prepare('UPDATE playlists SET stale = 1').run();
  }
}

export interface SyncItemsResult {
  synced: boolean;
  itemsReadable: boolean;
}

/**
 * Synchronisiert die Trackliste einer Playlist. Über snapshot_id wird erkannt,
 * ob sich etwas geändert hat; unverändert -> kein erneuter Volllauf.
 * Fremde Playlists liefern seit Februar 2026 einen 403 — das wird als
 * items_readable=0 persistiert statt als Fehler durchzuschlagen.
 */
export async function syncPlaylistItems(
  db: DB,
  spotify: SpotifyClient,
  playlistId: string,
  opts: { force?: boolean } = {},
): Promise<SyncItemsResult> {
  const existing = db
    .prepare('SELECT * FROM playlists WHERE id = ?')
    .get(playlistId) as PlaylistRow | undefined;

  const meta = await spotify.requestParsed(playlistMetaSchema, `/playlists/${playlistId}`, {
    query: { fields: 'id,name,snapshot_id,images,owner' },
  });

  const hasItems =
    ((db.prepare('SELECT COUNT(*) AS n FROM playlist_items WHERE playlist_id = ?').get(playlistId) as { n: number }).n ?? 0) > 0;
  const unchanged =
    !opts.force &&
    existing?.last_synced_at != null &&
    existing.snapshot_id != null &&
    meta.snapshot_id != null &&
    existing.snapshot_id === meta.snapshot_id &&
    (hasItems || existing.items_readable === 0);

  db.prepare(
    `INSERT INTO playlists (id, name, owner_id, image_url, stale)
     VALUES (@id, @name, @owner_id, @image_url, 0)
     ON CONFLICT(id) DO UPDATE SET name = @name, owner_id = @owner_id, image_url = @image_url, stale = 0`,
  ).run({
    id: meta.id,
    name: meta.name,
    owner_id: meta.owner.id,
    image_url: meta.images?.[0]?.url ?? null,
  });

  if (unchanged) {
    return { synced: false, itemsReadable: existing!.items_readable === 1 };
  }

  let entries: { track: SpotifyTrack }[];
  try {
    entries = await fetchAllItems(spotify, playlistId);
  } catch (err) {
    if (err instanceof SpotifyApiError && err.status === 403) {
      db.prepare(
        'UPDATE playlists SET items_readable = 0, snapshot_id = ?, last_synced_at = ? WHERE id = ?',
      ).run(meta.snapshot_id ?? null, Date.now(), playlistId);
      return { synced: true, itemsReadable: false };
    }
    throw err;
  }

  db.transaction(() => {
    const upsertTrack = db.prepare(
      `INSERT INTO tracks (id, name, artists_json, album_name, album_image_url, duration_ms)
       VALUES (@id, @name, @artists_json, @album_name, @album_image_url, @duration_ms)
       ON CONFLICT(id) DO UPDATE SET
         name = @name, artists_json = @artists_json, album_name = @album_name,
         album_image_url = @album_image_url, duration_ms = @duration_ms`,
    );
    const insertItem = db.prepare(
      'INSERT INTO playlist_items (playlist_id, position, track_id) VALUES (?, ?, ?)',
    );
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(playlistId);
    let position = 0;
    for (const { track } of entries) {
      upsertTrack.run({
        id: track.id,
        name: track.name,
        artists_json: JSON.stringify(track.artists.map((a) => a.name)),
        album_name: track.album?.name ?? null,
        album_image_url: track.album?.images?.at(-1)?.url ?? null,
        duration_ms: track.duration_ms,
      });
      insertItem.run(playlistId, position, track.id);
      position++;
    }
    db.prepare(
      'UPDATE playlists SET snapshot_id = ?, track_total = ?, items_readable = 1, last_synced_at = ? WHERE id = ?',
    ).run(meta.snapshot_id ?? null, position, Date.now(), playlistId);
  })();

  return { synced: true, itemsReadable: true };
}

async function fetchAllItems(
  spotify: SpotifyClient,
  playlistId: string,
): Promise<{ track: SpotifyTrack }[]> {
  const result: { track: SpotifyTrack }[] = [];
  let offset = 0;
  for (;;) {
    const page = await spotify.requestParsed(playlistItemsPageSchema, `/playlists/${playlistId}/items`, {
      query: { limit: ITEMS_PAGE_LIMIT, offset, additional_types: 'track' },
    });
    for (const entry of page.items) {
      // Lokale Dateien und Episoden haben keine spielbare Track-ID -> überspringen.
      if (!entry.item || !entry.item.id || (entry.item.type && entry.item.type !== 'track')) continue;
      result.push({ track: entry.item });
    }
    if (!page.next) break;
    offset += ITEMS_PAGE_LIMIT;
  }
  return result;
}
