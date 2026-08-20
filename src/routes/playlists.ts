import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../server.js';
import type { DB } from '../db.js';
import { syncPlaylists, syncPlaylistItems, type PlaylistRow } from '../services/sync.js';
import { getBlocks } from '../services/blocks.js';
import { ApiError } from '../errors.js';

export interface TrackDto {
  id: string;
  name: string;
  artists: string[];
  albumName: string | null;
  imageUrl: string | null;
  durationMs: number;
}

interface TrackRow {
  id: string;
  name: string;
  artists_json: string;
  album_name: string | null;
  album_image_url: string | null;
  duration_ms: number;
}

export function trackDto(row: TrackRow): TrackDto {
  return {
    id: row.id,
    name: row.name,
    artists: JSON.parse(row.artists_json) as string[],
    albumName: row.album_name,
    imageUrl: row.album_image_url,
    durationMs: row.duration_ms,
  };
}

export function getTrackMap(db: DB, trackIds: string[]): Map<string, TrackDto> {
  const map = new Map<string, TrackDto>();
  const stmt = db.prepare('SELECT * FROM tracks WHERE id = ?');
  for (const id of new Set(trackIds)) {
    const row = stmt.get(id) as TrackRow | undefined;
    if (row) map.set(id, trackDto(row));
  }
  return map;
}

export function requirePlaylist(db: DB, id: string): PlaylistRow {
  const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as PlaylistRow | undefined;
  if (!row) throw new ApiError(404, 'playlist_not_found', 'Playlist nicht gefunden.');
  return row;
}

export function playlistDetail(db: DB, playlistId: string) {
  const playlist = requirePlaylist(db, playlistId);
  const items = db
    .prepare(
      `SELECT pi.position, t.* FROM playlist_items pi
       JOIN tracks t ON t.id = pi.track_id
       WHERE pi.playlist_id = ? ORDER BY pi.position`,
    )
    .all(playlistId) as ({ position: number } & TrackRow)[];
  const blocks = getBlocks(db, playlistId);
  const membership = new Map<string, string>();
  for (const b of blocks) {
    for (const item of b.items) membership.set(item.trackId, b.id);
  }
  const blockTrackIds = blocks.flatMap((b) => b.items.map((i) => i.trackId));
  const trackMap = getTrackMap(db, blockTrackIds);

  return {
    playlist: {
      id: playlist.id,
      name: playlist.name,
      ownerId: playlist.owner_id,
      imageUrl: playlist.image_url,
      trackTotal: playlist.track_total,
      itemsReadable: playlist.items_readable === 1,
      lastSyncedAt: playlist.last_synced_at,
    },
    tracks: items.map((row) => ({
      position: row.position,
      ...trackDto(row),
      blockId: membership.get(row.id) ?? null,
    })),
    blocks: blocks.map((b) => ({
      id: b.id,
      name: b.name,
      color: b.color,
      items: b.items.map((i) => ({
        trackId: i.trackId,
        position: i.position,
        orphaned: i.orphaned,
        track: trackMap.get(i.trackId) ?? null,
      })),
    })),
  };
}

export function registerPlaylistRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/playlists', async (req) => {
    const query = z.object({ refresh: z.coerce.boolean().default(false) }).parse(req.query);
    const count = (ctx.db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE stale = 0').get() as { n: number }).n;
    if (query.refresh || count === 0) {
      await syncPlaylists(ctx.db, ctx.spotify);
    }
    const rows = ctx.db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM blocks b WHERE b.playlist_id = p.id) AS block_count
         FROM playlists p
         WHERE p.stale = 0 AND p.id NOT IN (SELECT shadow_playlist_id FROM shadow_playlists)
         ORDER BY p.name COLLATE NOCASE`,
      )
      .all() as (PlaylistRow & { block_count: number })[];
    return {
      playlists: rows.map((r) => ({
        id: r.id,
        name: r.name,
        ownerId: r.owner_id,
        imageUrl: r.image_url,
        trackTotal: r.track_total,
        itemsReadable: r.items_readable === 1,
        blockCount: r.block_count,
      })),
    };
  });

  app.get('/api/playlists/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const query = z.object({ refresh: z.coerce.boolean().default(false) }).parse(req.query);
    await syncPlaylistItems(ctx.db, ctx.spotify, id, { force: query.refresh });
    return playlistDetail(ctx.db, id);
  });
}
