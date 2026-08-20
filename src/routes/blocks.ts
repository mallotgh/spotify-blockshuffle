import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../server.js';
import {
  createBlock,
  updateBlock,
  setBlockItems,
  addTrackToBlock,
  removeTrackFromBlock,
  deleteBlock,
  getBlock,
} from '../services/blocks.js';
import { playlistDetail, requirePlaylist } from './playlists.js';

export function registerBlockRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/playlists/:id/blocks', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        trackIds: z.array(z.string()).min(2),
        name: z.string().optional(),
        color: z.string().optional(),
      })
      .parse(req.body);
    requirePlaylist(ctx.db, id);
    createBlock(ctx.db, id, body.trackIds, body);
    reply.status(201);
    return { detail: playlistDetail(ctx.db, id) };
  });

  app.patch('/api/blocks/:blockId', async (req) => {
    const { blockId } = z.object({ blockId: z.string() }).parse(req.params);
    const body = z.object({ name: z.string().optional(), color: z.string().optional() }).parse(req.body);
    const block = updateBlock(ctx.db, blockId, body);
    return { detail: playlistDetail(ctx.db, block.playlist_id) };
  });

  app.put('/api/blocks/:blockId/items', async (req) => {
    const { blockId } = z.object({ blockId: z.string() }).parse(req.params);
    const body = z
      .object({ trackIds: z.array(z.string()).min(2) })
      .parse(req.body);
    const block = setBlockItems(ctx.db, blockId, body.trackIds);
    return { detail: playlistDetail(ctx.db, block.playlist_id) };
  });

  app.post('/api/blocks/:blockId/items', async (req) => {
    const { blockId } = z.object({ blockId: z.string() }).parse(req.params);
    const body = z.object({ trackId: z.string() }).parse(req.body);
    const block = addTrackToBlock(ctx.db, blockId, body.trackId);
    return { detail: playlistDetail(ctx.db, block.playlist_id) };
  });

  app.delete('/api/blocks/:blockId/items/:trackId', async (req) => {
    const params = z.object({ blockId: z.string(), trackId: z.string() }).parse(req.params);
    const playlistId = getBlock(ctx.db, params.blockId).playlist_id;
    const result = removeTrackFromBlock(ctx.db, params.blockId, params.trackId);
    return { ...result, detail: playlistDetail(ctx.db, playlistId) };
  });

  app.delete('/api/blocks/:blockId', async (req) => {
    const { blockId } = z.object({ blockId: z.string() }).parse(req.params);
    const playlistId = getBlock(ctx.db, blockId).playlist_id;
    deleteBlock(ctx.db, blockId);
    return { ok: true, detail: playlistDetail(ctx.db, playlistId) };
  });
}
