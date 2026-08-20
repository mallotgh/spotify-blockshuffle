import { config, missingSpotifyEnv } from './config.js';
import { openDb } from './db.js';
import { buildServer } from './server.js';
import { SpotifyClient } from './spotify/client.js';

const db = openDb(config.dataDir);
const spotify = new SpotifyClient(db);
const app = buildServer({ db, spotify, staticDir: config.staticDir });

const missing = missingSpotifyEnv();
if (missing.length > 0) {
  app.log.warn(
    `${missing.join(', ')} nicht gesetzt — der Login wird fehlschlagen, bis sie konfiguriert sind.`,
  );
}

app
  .listen({ port: config.port, host: config.host })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
