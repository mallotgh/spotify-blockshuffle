import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import type { DB } from './db.js';
import { SpotifyClient } from './spotify/client.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPlaylistRoutes } from './routes/playlists.js';
import { registerBlockRoutes } from './routes/blocks.js';
import { registerShuffleRoutes } from './routes/shuffle.js';
import { registerPlayerRoutes } from './routes/player.js';
import { ApiError } from './errors.js';

export interface AppContext {
  db: DB;
  spotify: SpotifyClient;
  staticDir: string;
}

export function buildServer(ctx: AppContext): FastifyInstance {
  const app = Fastify({
    logger: {
      level: 'info',
      redact: ['req.headers.authorization'],
    },
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiError) {
      reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
      return;
    }
    if (err instanceof ZodError) {
      reply.status(400).send({ error: 'bad_request', message: 'Ungültige Anfrage.', details: err.issues });
      return;
    }
    if (typeof err === 'object' && err !== null && 'validation' in err) {
      reply.status(400).send({ error: 'bad_request', message: 'Ungültige Anfrage.' });
      return;
    }
    req.log.error(err);
    reply.status(500).send({ error: 'internal', message: 'Interner Fehler. Details im Server-Log.' });
  });

  app.get('/api/health', async () => ({ status: 'ok' }));

  registerAuthRoutes(app, ctx);
  registerPlaylistRoutes(app, ctx);
  registerBlockRoutes(app, ctx);
  registerShuffleRoutes(app, ctx);
  registerPlayerRoutes(app, ctx);

  if (fs.existsSync(ctx.staticDir)) {
    app.register(fastifyStatic, { root: ctx.staticDir });
    // SPA-Fallback: alles außer /api und /callback bekommt die index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/') || req.raw.url?.startsWith('/callback')) {
        reply.status(404).send({ error: 'not_found', message: 'Nicht gefunden.' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  return app;
}
