import { config } from './config.js';
import { openDb } from './db.js';
import { buildServer } from './server.js';
import { SpotifyClient } from './spotify/client.js';

const db = openDb(config.dataDir);
const spotify = new SpotifyClient(db);
const app = buildServer({ db, spotify, staticDir: config.staticDir });

if (!config.spotify.clientId || !config.spotify.clientSecret || !config.spotify.redirectUri) {
  app.log.warn(
    'SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REDIRECT_URI sind nicht vollständig gesetzt — der Login wird fehlschlagen, bis sie konfiguriert sind.',
  );
}

app
  .listen({ port: config.port, host: config.host })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
