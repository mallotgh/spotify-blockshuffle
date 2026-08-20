import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../server.js';
import { blockShuffle, type ShuffleUnit } from '../shuffle/engine.js';
import { generateSeed } from '../shuffle/rng.js';
import { syncPlaylistItems } from '../services/sync.js';
import { getBlocks } from '../services/blocks.js';
import { startPlayback } from '../services/playback.js';
import { requirePlaylist, getTrackMap } from './playlists.js';
import { ApiError } from '../errors.js';

export interface ShuffleRunRow {
  id: string;
  playlist_id: string;
  seed: string;
  order_json: string;
  created_at: number;
  played_at: number | null;
}

export function latestRun(db: AppContext['db'], playlistId: string): ShuffleRunRow | undefined {
  return db
    .prepare('SELECT * FROM shuffle_runs WHERE playlist_id = ? ORDER BY created_at DESC, id LIMIT 1')
    .get(playlistId) as ShuffleRunRow | undefined;
}

/** Der zuletzt tatsächlich abgespielte Lauf — Vorschau-Läufe zählen nicht. */
export function latestPlayedRun(db: AppContext['db']): ShuffleRunRow | undefined {
  return db
    .prepare('SELECT * FROM shuffle_runs WHERE played_at IS NOT NULL ORDER BY played_at DESC, id LIMIT 1')
    .get() as ShuffleRunRow | undefined;
}

function runDto(db: AppContext['db'], run: ShuffleRunRow) {
  const units = JSON.parse(run.order_json) as ShuffleUnit[];
  const trackMap = getTrackMap(db, units.flatMap((u) => u.trackIds));
  return {
    runId: run.id,
    playlistId: run.playlist_id,
    seed: run.seed,
    createdAt: run.created_at,
    trackCount: units.reduce((n, u) => n + u.trackIds.length, 0),
    units: units.map((u) => ({
      blockId: u.blockId,
      blockName: u.blockName,
      tracks: u.trackIds.map((id) => ({ trackId: id, track: trackMap.get(id) ?? null })),
    })),
  };
}

export function registerShuffleRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Berechnet eine neue Reihenfolge (Vorschau) und speichert sie als shuffle_run. */
  app.post('/api/playlists/:id/shuffle', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ seed: z.string().trim().min(1).optional() }).parse(req.body ?? {});

    await syncPlaylistItems(ctx.db, ctx.spotify, id);
    const playlist = requirePlaylist(ctx.db, id);
    if (playlist.items_readable !== 1) {
      throw new ApiError(
        409,
        'items_not_readable',
        'Für fremde (nur gefolgte) Playlists liefert Spotify keine Tracklisten mehr — Blockshuffle ist hier nicht möglich.',
      );
    }
    const playlistOrder = (
      ctx.db
        .prepare('SELECT track_id FROM playlist_items WHERE playlist_id = ? ORDER BY position')
        .all(id) as { track_id: string }[]
    ).map((r) => r.track_id);
    if (playlistOrder.length === 0) {
      throw new ApiError(409, 'playlist_empty', 'Die Playlist enthält keine abspielbaren Tracks.');
    }

    const blocks = getBlocks(ctx.db, id).map((b) => ({
      id: b.id,
      name: b.name,
      trackIds: b.items.map((i) => i.trackId),
    }));

    const seed = body.seed ?? generateSeed();
    const result = blockShuffle({ playlistOrder, blocks }, seed);

    const run: ShuffleRunRow = {
      id: crypto.randomUUID(),
      playlist_id: id,
      seed,
      order_json: JSON.stringify(result.units),
      created_at: Date.now(),
      played_at: null,
    };
    ctx.db
      .prepare('INSERT INTO shuffle_runs (id, playlist_id, seed, order_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(run.id, run.playlist_id, run.seed, run.order_json, run.created_at);

    reply.status(201);
    return { ...runDto(ctx.db, run), skippedOrphans: result.skippedOrphans };
  });

  /** Startet die Wiedergabe eines gespeicherten Laufs. */
  app.post('/api/shuffle/:runId/play', async (req) => {
    const { runId } = z.object({ runId: z.string() }).parse(req.params);
    const body = z
      .object({
        deviceId: z.string().optional(),
        mode: z.enum(['auto', 'shadow', 'uris']).default('auto'),
      })
      .parse(req.body ?? {});

    const run = ctx.db.prepare('SELECT * FROM shuffle_runs WHERE id = ?').get(runId) as
      | ShuffleRunRow
      | undefined;
    if (!run) throw new ApiError(404, 'run_not_found', 'Shuffle-Lauf nicht gefunden.');
    const playlist = requirePlaylist(ctx.db, run.playlist_id);
    const units = JSON.parse(run.order_json) as ShuffleUnit[];

    // Die Playlist kann sich seit der Berechnung geändert haben: inzwischen
    // entfernte Tracks werden auch beim Abspielen eines alten Laufs übersprungen.
    await syncPlaylistItems(ctx.db, ctx.spotify, run.playlist_id);
    const inPlaylist = new Set(
      (
        ctx.db
          .prepare('SELECT DISTINCT track_id FROM playlist_items WHERE playlist_id = ?')
          .all(run.playlist_id) as { track_id: string }[]
      ).map((r) => r.track_id),
    );
    const allTrackIds = units.flatMap((u) => u.trackIds);
    const trackIds = allTrackIds.filter((t) => inPlaylist.has(t));
    if (trackIds.length === 0) {
      throw new ApiError(409, 'playlist_empty', 'Kein Track dieses Laufs ist noch in der Playlist.');
    }

    const result = await startPlayback(ctx.db, ctx.spotify, {
      playlistId: run.playlist_id,
      playlistName: playlist.name,
      trackIds,
      deviceId: body.deviceId,
      mode: body.mode,
    });
    ctx.db.prepare('UPDATE shuffle_runs SET played_at = ? WHERE id = ?').run(Date.now(), run.id);
    return {
      ok: true,
      ...result,
      trackCount: trackIds.length,
      skippedTracks: allTrackIds.length - trackIds.length,
    };
  });

  /** Letzter Lauf einer Playlist (z. B. um die Vorschau wieder zu öffnen). */
  app.get('/api/playlists/:id/shuffle/latest', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const run = latestRun(ctx.db, id);
    if (!run) return { run: null };
    return { run: runDto(ctx.db, run) };
  });
}
