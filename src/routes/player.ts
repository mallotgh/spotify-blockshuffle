import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../server.js';
import { devicesResponseSchema, playerStateSchema } from '../spotify/schemas.js';
import type { ShuffleUnit } from '../shuffle/engine.js';
import { latestPlayedRun } from './shuffle.js';
import { mapPlayerError } from '../services/playback.js';

export function registerPlayerRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/player/devices', async () => {
    try {
      const res = await ctx.spotify.requestParsed(devicesResponseSchema, '/me/player/devices');
      return {
        devices: res.devices
          .filter((d) => d.id !== null && !d.is_restricted)
          .map((d) => ({ id: d.id!, name: d.name, type: d.type, isActive: d.is_active })),
      };
    } catch (err) {
      mapPlayerError(err);
    }
  });

  /**
   * Aktueller Wiedergabestatus inkl. Block-Zuordnung zum letzten Shuffle-Lauf
   * ("Block 7 von 23 · Track 2 von 3") und Warnung, falls Spotifys eigener
   * Shuffle extern wieder eingeschaltet wurde.
   */
  app.get('/api/player/status', async () => {
    const raw = await ctx.spotify.request('/me/player');
    if (raw === null) {
      return { active: false };
    }
    const parsed = playerStateSchema.safeParse(raw);
    if (!parsed.success) {
      return { active: false };
    }
    const state = parsed.data;
    const track = state.item
      ? {
          id: state.item.id,
          name: state.item.name,
          artists: state.item.artists.map((a) => a.name),
          durationMs: state.item.duration_ms,
          imageUrl: state.item.album?.images?.at(-1)?.url ?? null,
        }
      : null;

    let runInfo: unknown = null;
    const run = latestPlayedRun(ctx.db);
    // Blockinfo nur anzeigen, wenn die laufende Wiedergabe wirklich zu diesem
    // Lauf gehört: entweder Kontext = zugehörige Shadow-Playlist (Weg A) oder
    // kontextlose URI-Wiedergabe (Weg B).
    const shadowId = run
      ? ((
          ctx.db
            .prepare('SELECT shadow_playlist_id FROM shadow_playlists WHERE playlist_id = ?')
            .get(run.playlist_id) as { shadow_playlist_id: string } | undefined
        )?.shadow_playlist_id ?? null)
      : null;
    const contextMatchesRun =
      state.context == null || (shadowId !== null && state.context.uri === `spotify:playlist:${shadowId}`);
    if (run && track?.id && contextMatchesRun) {
      const units = JSON.parse(run.order_json) as ShuffleUnit[];
      const idx = units.findIndex((u) => u.trackIds.includes(track.id!));
      if (idx >= 0) {
        const unit = units[idx]!;
        const playlistName = (
          ctx.db.prepare('SELECT name FROM playlists WHERE id = ?').get(run.playlist_id) as
            | { name: string }
            | undefined
        )?.name;
        runInfo = {
          runId: run.id,
          playlistId: run.playlist_id,
          playlistName: playlistName ?? null,
          seed: run.seed,
          blockIndex: idx + 1,
          blockCount: units.length,
          blockName: unit.blockName,
          blockId: unit.blockId,
          trackInBlock: unit.trackIds.indexOf(track.id) + 1,
          blockSize: unit.trackIds.length,
        };
      }
    }

    return {
      active: true,
      isPlaying: state.is_playing ?? false,
      progressMs: state.progress_ms ?? null,
      shuffleWarning: state.shuffle_state === true,
      device: state.device ? { id: state.device.id, name: state.device.name } : null,
      track,
      run: runInfo,
    };
  });
}
