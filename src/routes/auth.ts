import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../server.js';
import { config, assertSpotifyConfig } from '../config.js';
import { codeChallengeS256, generateCodeVerifier, generateState } from '../spotify/pkce.js';
import { userProfileSchema } from '../spotify/schemas.js';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
/** Laufende Login-Versuche: state -> code_verifier (mit Ablauf). */
const pendingLogins = new Map<string, { verifier: string; expiresAt: number }>();

function prunePendingLogins(): void {
  const now = Date.now();
  for (const [state, entry] of pendingLogins) {
    if (entry.expiresAt < now) pendingLogins.delete(state);
  }
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/auth/status', async () => {
    const auth = ctx.spotify.getAuth();
    if (!auth) return { authenticated: false };
    return {
      authenticated: true,
      user: { id: auth.user_id, displayName: auth.display_name },
    };
  });

  app.get('/api/auth/login', async (req, reply) => {
    assertSpotifyConfig();
    prunePendingLogins();
    const state = generateState();
    const verifier = generateCodeVerifier();
    pendingLogins.set(state, { verifier, expiresAt: Date.now() + 10 * 60_000 });

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.spotify.clientId);
    url.searchParams.set('redirect_uri', config.spotify.redirectUri);
    url.searchParams.set('scope', config.spotify.scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('code_challenge', codeChallengeS256(verifier));
    reply.redirect(url.toString());
  });

  app.get('/callback', async (req, reply) => {
    const query = z
      .object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(req.query);

    if (query.error) {
      reply.type('text/html; charset=utf-8').send(callbackErrorPage(`Spotify meldet: ${query.error}`));
      return;
    }
    const pending = query.state ? pendingLogins.get(query.state) : undefined;
    if (!query.code || !pending) {
      reply
        .type('text/html; charset=utf-8')
        .send(callbackErrorPage('Ungültiger oder abgelaufener Login-Versuch. Bitte erneut anmelden.'));
      return;
    }
    pendingLogins.delete(query.state!);

    await ctx.spotify.exchangeCode(query.code, pending.verifier);
    const profile = await ctx.spotify.requestParsed(userProfileSchema, '/me');
    ctx.spotify.saveUserProfile(profile.id, profile.display_name ?? null);

    reply.redirect('/');
  });

  app.post('/api/auth/logout', async () => {
    ctx.spotify.logout();
    return { ok: true };
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function callbackErrorPage(message: string): string {
  return `<!doctype html><html lang="de"><meta charset="utf-8"><title>Anmeldung fehlgeschlagen</title>
<body style="font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem">
<h1>Anmeldung fehlgeschlagen</h1><p>${escapeHtml(message)}</p><p><a href="/">Zurück zur App</a></p></body></html>`;
}
