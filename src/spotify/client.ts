import { z } from 'zod';
import type { DB } from '../db.js';
import { config } from '../config.js';
import { ApiError, notAuthenticated } from '../errors.js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';
/** Access-Token proaktiv erneuern, wenn weniger als 60 s Restlaufzeit. */
const REFRESH_MARGIN_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 3;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

export interface AuthRow {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  user_id: string | null;
  display_name: string | null;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export class SpotifyApiError extends ApiError {
  constructor(
    public status: number,
    message: string,
    public endpoint: string,
  ) {
    super(status >= 500 ? 502 : status, 'spotify_api_error', message, { endpoint, status });
    this.name = 'SpotifyApiError';
  }
}

/** Retry-After kann Sekunden oder ein HTTP-Datum sein (RFC 9110); auf 1–30 s begrenzen. */
function parseRetryAfterMs(header: string | null): number {
  let seconds = Number(header ?? '');
  if (!Number.isFinite(seconds) && header) {
    const date = Date.parse(header);
    if (Number.isFinite(date)) seconds = (date - Date.now()) / 1000;
  }
  if (!Number.isFinite(seconds)) seconds = 2;
  return Math.min(Math.max(seconds, 1), 30) * 1000;
}

export class SpotifyClient {
  private refreshPromise: Promise<void> | null = null;

  constructor(private db: DB) {}

  getAuth(): AuthRow | null {
    return (this.db.prepare('SELECT * FROM auth WHERE id = 1').get() as AuthRow | undefined) ?? null;
  }

  saveTokens(tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string;
  }): void {
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    this.db
      .prepare(
        `INSERT INTO auth (id, access_token, refresh_token, expires_at, scope)
         VALUES (1, @access_token, @refresh_token, @expires_at, @scope)
         ON CONFLICT(id) DO UPDATE SET
           access_token = @access_token,
           refresh_token = @refresh_token,
           expires_at = @expires_at,
           scope = @scope`,
      )
      .run({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scope: tokens.scope ?? '',
      });
  }

  saveUserProfile(userId: string, displayName: string | null): void {
    this.db
      .prepare('UPDATE auth SET user_id = ?, display_name = ? WHERE id = 1')
      .run(userId, displayName);
  }

  logout(): void {
    this.db.prepare('DELETE FROM auth WHERE id = 1').run();
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<void> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.spotify.redirectUri,
      code_verifier: codeVerifier,
    });
    const tokens = await this.tokenRequest(body);
    if (!tokens.refresh_token) {
      throw new ApiError(502, 'token_exchange_failed', 'Spotify hat keinen Refresh-Token geliefert.');
    }
    this.saveTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
    });
  }

  /** Erneuert den Access-Token. Parallele Aufrufe teilen sich einen Refresh. */
  private refreshAccessToken(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    const auth = this.getAuth();
    if (!auth) throw notAuthenticated();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: auth.refresh_token,
    });
    const tokens = await this.tokenRequest(body);
    // Hat sich der Nutzer während des laufenden Refreshs abgemeldet, dürfen die
    // neuen Tokens die gelöschte Session nicht wiederbeleben.
    if (!this.getAuth()) throw notAuthenticated();
    this.saveTokens({
      access_token: tokens.access_token,
      // Spotify rotiert den Refresh-Token gelegentlich; sonst den alten behalten.
      refresh_token: tokens.refresh_token ?? auth.refresh_token,
      expires_in: tokens.expires_in,
      scope: tokens.scope ?? auth.scope,
    });
  }

  private async tokenRequest(body: URLSearchParams) {
    const basic = Buffer.from(
      `${config.spotify.clientId}:${config.spotify.clientSecret}`,
    ).toString('base64');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 400 && text.includes('invalid_grant')) {
        // Refresh-Token widerrufen -> Neuanmeldung nötig
        this.logout();
        throw notAuthenticated();
      }
      throw new ApiError(502, 'token_request_failed', `Spotify-Token-Endpunkt: HTTP ${res.status}`, text);
    }
    return tokenResponseSchema.parse(await res.json());
  }

  private async ensureAccessToken(): Promise<string> {
    const auth = this.getAuth();
    if (!auth) throw notAuthenticated();
    if (auth.expires_at - Date.now() < REFRESH_MARGIN_MS) {
      await this.refreshAccessToken();
      return this.getAuth()!.access_token;
    }
    return auth.access_token;
  }

  /**
   * Zentraler Request-Wrapper: kümmert sich um Token, wiederholt einmal bei 401
   * und respektiert Retry-After bei 429.
   */
  async request(path: string, opts: RequestOptions = {}): Promise<unknown> {
    let retried401 = false;
    let rateLimitRetries = 0;

    for (;;) {
      const token = await this.ensureAccessToken();
      const url = new URL(API_BASE + path);
      for (const [k, v] of Object.entries(opts.query ?? {})) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });

      if (res.status === 401 && !retried401) {
        retried401 = true;
        await this.refreshAccessToken();
        continue;
      }
      if (res.status === 429 && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
        rateLimitRetries++;
        await new Promise((r) => setTimeout(r, parseRetryAfterMs(res.headers.get('retry-after'))));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let message = `Spotify-API ${opts.method ?? 'GET'} ${path}: HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(text) as { error?: { message?: string } };
          if (parsed.error?.message) message += ` – ${parsed.error.message}`;
        } catch {
          /* Rohtext ignorieren */
        }
        throw new SpotifyApiError(res.status, message, path);
      }
      if (res.status === 204) return null;
      const text = await res.text();
      return text.length > 0 ? (JSON.parse(text) as unknown) : null;
    }
  }

  /** request + Zod-Validierung; wirft eine klare Fehlermeldung bei Schema-Drift. */
  async requestParsed<T>(schema: z.ZodType<T>, path: string, opts: RequestOptions = {}): Promise<T> {
    const raw = await this.request(path, opts);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiError(
        502,
        'unexpected_api_schema',
        `Unerwartetes Antwortformat von Spotify für ${path}. Möglicherweise hat sich die API erneut geändert.`,
        parsed.error.issues.slice(0, 5),
      );
    }
    return parsed.data;
  }
}
