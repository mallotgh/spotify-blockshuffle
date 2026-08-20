import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  // 1: Grundschema
  `
  CREATE TABLE auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    scope TEXT NOT NULL DEFAULT '',
    user_id TEXT,
    display_name TEXT
  );

  CREATE TABLE playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    snapshot_id TEXT,
    image_url TEXT,
    track_total INTEGER NOT NULL DEFAULT 0,
    items_readable INTEGER NOT NULL DEFAULT 1,
    stale INTEGER NOT NULL DEFAULT 0,
    last_synced_at INTEGER
  );

  CREATE TABLE tracks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    artists_json TEXT NOT NULL,
    album_name TEXT,
    album_image_url TEXT,
    duration_ms INTEGER NOT NULL
  );

  CREATE TABLE playlist_items (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    track_id TEXT NOT NULL REFERENCES tracks(id),
    PRIMARY KEY (playlist_id, position)
  );
  CREATE INDEX idx_playlist_items_track ON playlist_items(playlist_id, track_id);

  CREATE TABLE blocks (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_blocks_playlist ON blocks(playlist_id);

  CREATE TABLE block_items (
    block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (block_id, track_id),
    UNIQUE (block_id, position)
  );

  CREATE TABLE shuffle_runs (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    seed TEXT NOT NULL,
    order_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_shuffle_runs_playlist ON shuffle_runs(playlist_id, created_at);

  CREATE TABLE shadow_playlists (
    playlist_id TEXT PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,
    shadow_playlist_id TEXT NOT NULL
  );
  `,
];

export function openDb(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'blockshuffle.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function openMemoryDb(): DB {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
