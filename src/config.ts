import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8973),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  STATIC_DIR: z.string().default('./web/dist'),
  SPOTIFY_CLIENT_ID: z.string().default(''),
  SPOTIFY_CLIENT_SECRET: z.string().default(''),
  SPOTIFY_REDIRECT_URI: z.string().default(''),
});

const env = envSchema.parse(process.env);

export const config = {
  port: env.PORT,
  host: env.HOST,
  dataDir: path.resolve(env.DATA_DIR),
  staticDir: path.resolve(env.STATIC_DIR),
  spotify: {
    clientId: env.SPOTIFY_CLIENT_ID,
    clientSecret: env.SPOTIFY_CLIENT_SECRET,
    redirectUri: env.SPOTIFY_REDIRECT_URI,
    scopes: [
      'playlist-read-private',
      'playlist-read-collaborative',
      'playlist-modify-private',
      'playlist-modify-public',
      'user-read-playback-state',
      'user-modify-playback-state',
    ],
  },
};

export function missingSpotifyEnv(): string[] {
  const missing: string[] = [];
  if (!config.spotify.clientId) missing.push('SPOTIFY_CLIENT_ID');
  if (!config.spotify.clientSecret) missing.push('SPOTIFY_CLIENT_SECRET');
  if (!config.spotify.redirectUri) missing.push('SPOTIFY_REDIRECT_URI');
  return missing;
}

export function assertSpotifyConfig(): void {
  const missing = missingSpotifyEnv();
  if (missing.length > 0) {
    throw new Error(`Fehlende Umgebungsvariablen: ${missing.join(', ')}`);
  }
}
