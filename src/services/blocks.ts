import crypto from 'node:crypto';
import type { DB } from '../db.js';
import { ApiError } from '../errors.js';

/**
 * Invarianten (werden hier serverseitig erzwungen):
 *  - Ein Track darf zu mehreren Blöcken gehören (er spielt dann einmal pro Block).
 *  - Ein Block hat mindestens 2 Tracks; schrumpft er auf einen, wird er aufgelöst.
 *  - block_items.position ist pro Block lückenlos ab 0.
 */

export const BLOCK_COLORS = [
  '#e05252', '#e0a052', '#d4c94a', '#6fbf5a', '#4ec9b0',
  '#4a9de0', '#7a6fe0', '#b45ce0', '#e05c9e', '#8a9a5b',
];

export interface BlockRow {
  id: string;
  playlist_id: string;
  name: string;
  color: string;
  created_at: number;
}

export interface BlockWithItems extends BlockRow {
  items: { trackId: string; position: number; orphaned: boolean }[];
}

function playlistTrackIds(db: DB, playlistId: string): Set<string> {
  const rows = db
    .prepare('SELECT DISTINCT track_id FROM playlist_items WHERE playlist_id = ?')
    .all(playlistId) as { track_id: string }[];
  return new Set(rows.map((r) => r.track_id));
}

function playlistPosition(db: DB, playlistId: string): Map<string, number> {
  const rows = db
    .prepare('SELECT track_id, MIN(position) AS pos FROM playlist_items WHERE playlist_id = ? GROUP BY track_id')
    .all(playlistId) as { track_id: string; pos: number }[];
  return new Map(rows.map((r) => [r.track_id, r.pos]));
}

export function getBlocks(db: DB, playlistId: string): BlockWithItems[] {
  const inPlaylist = playlistTrackIds(db, playlistId);
  const blocks = db
    .prepare('SELECT * FROM blocks WHERE playlist_id = ? ORDER BY created_at, id')
    .all(playlistId) as BlockRow[];
  const itemRows = db
    .prepare(
      `SELECT bi.block_id, bi.track_id, bi.position FROM block_items bi
       JOIN blocks b ON b.id = bi.block_id
       WHERE b.playlist_id = ? ORDER BY bi.block_id, bi.position`,
    )
    .all(playlistId) as { block_id: string; track_id: string; position: number }[];
  const itemsByBlock = new Map<string, BlockWithItems['items']>();
  for (const row of itemRows) {
    let list = itemsByBlock.get(row.block_id);
    if (!list) {
      list = [];
      itemsByBlock.set(row.block_id, list);
    }
    list.push({ trackId: row.track_id, position: row.position, orphaned: !inPlaylist.has(row.track_id) });
  }
  return blocks.map((b) => ({ ...b, items: itemsByBlock.get(b.id) ?? [] }));
}

export function getBlockWithItems(db: DB, blockId: string): BlockWithItems {
  const block = getBlock(db, blockId);
  return getBlocks(db, block.playlist_id).find((b) => b.id === blockId)!;
}

export function getBlock(db: DB, blockId: string): BlockRow {
  const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId) as BlockRow | undefined;
  if (!block) throw new ApiError(404, 'block_not_found', 'Block nicht gefunden.');
  return block;
}

function nextColor(db: DB, playlistId: string): string {
  const used = (
    db.prepare('SELECT color FROM blocks WHERE playlist_id = ?').all(playlistId) as { color: string }[]
  ).map((r) => r.color);
  return BLOCK_COLORS.find((c) => !used.includes(c)) ?? BLOCK_COLORS[used.length % BLOCK_COLORS.length]!;
}

/** Löst einen Block unter 2 Tracks auf, sonst Positionen lückenlos ab 0 halten. */
function cleanupBlock(db: DB, blockId: string): { dissolved: boolean } {
  const rest = db
    .prepare('SELECT track_id FROM block_items WHERE block_id = ? ORDER BY position')
    .all(blockId) as { track_id: string }[];
  if (rest.length < 2) {
    db.prepare('DELETE FROM blocks WHERE id = ?').run(blockId);
    return { dissolved: true };
  }
  const update = db.prepare('UPDATE block_items SET position = ? WHERE block_id = ? AND track_id = ?');
  rest.forEach((r, i) => update.run(i, blockId, r.track_id));
  return { dissolved: false };
}

export function createBlock(
  db: DB,
  playlistId: string,
  trackIds: string[],
  opts: { name?: string; color?: string } = {},
): BlockWithItems {
  const unique = [...new Set(trackIds)];
  if (unique.length < 2) {
    throw new ApiError(400, 'block_too_small', 'Ein Block braucht mindestens 2 Tracks.');
  }
  const inPlaylist = playlistTrackIds(db, playlistId);
  const missing = unique.filter((t) => !inPlaylist.has(t));
  if (missing.length > 0) {
    throw new ApiError(400, 'track_not_in_playlist', 'Tracks gehören nicht zu dieser Playlist.', { missing });
  }

  return db.transaction(() => {
    // Initialreihenfolge = Playlist-Reihenfolge
    const pos = playlistPosition(db, playlistId);
    const ordered = [...unique].sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));

    const id = crypto.randomUUID();
    const firstTrackName = (
      db.prepare('SELECT name FROM tracks WHERE id = ?').get(ordered[0]!) as { name: string } | undefined
    )?.name;
    db.prepare(
      'INSERT INTO blocks (id, playlist_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, playlistId, opts.name?.trim() || firstTrackName || 'Block', opts.color ?? nextColor(db, playlistId), Date.now());
    const insert = db.prepare('INSERT INTO block_items (block_id, track_id, position) VALUES (?, ?, ?)');
    ordered.forEach((t, i) => insert.run(id, t, i));
    return getBlockWithItems(db, id);
  })();
}

export function updateBlock(db: DB, blockId: string, patch: { name?: string; color?: string }): BlockRow {
  const block = getBlock(db, blockId);
  const name = patch.name?.trim() || block.name;
  const color = patch.color ?? block.color;
  db.prepare('UPDATE blocks SET name = ?, color = ? WHERE id = ?').run(name, color, blockId);
  return getBlock(db, blockId);
}

/** Setzt die komplette (Reihenfolge der) Trackliste eines Blocks. */
export function setBlockItems(
  db: DB,
  blockId: string,
  trackIds: string[],
): BlockWithItems {
  const block = getBlock(db, blockId);
  const unique = [...new Set(trackIds)];
  if (unique.length < 2) {
    throw new ApiError(400, 'block_too_small', 'Ein Block braucht mindestens 2 Tracks.');
  }
  const current = new Set(
    (db.prepare('SELECT track_id FROM block_items WHERE block_id = ?').all(blockId) as { track_id: string }[]).map(
      (r) => r.track_id,
    ),
  );
  const inPlaylist = playlistTrackIds(db, block.playlist_id);
  // Neu hinzukommende Tracks müssen in der Playlist liegen; bestehende
  // (auch verwaiste) dürfen bleiben und umsortiert werden.
  const invalid = unique.filter((t) => !current.has(t) && !inPlaylist.has(t));
  if (invalid.length > 0) {
    throw new ApiError(400, 'track_not_in_playlist', 'Tracks gehören nicht zu dieser Playlist.', { missing: invalid });
  }

  return db.transaction(() => {
    db.prepare('DELETE FROM block_items WHERE block_id = ?').run(blockId);
    const insert = db.prepare('INSERT INTO block_items (block_id, track_id, position) VALUES (?, ?, ?)');
    unique.forEach((t, i) => insert.run(blockId, t, i));
    return getBlockWithItems(db, blockId);
  })();
}

export interface RemoveResult {
  dissolved: boolean;
}

/** Entfernt einen Track; schrumpft der Block unter 2 Tracks, wird er aufgelöst. */
export function removeTrackFromBlock(db: DB, blockId: string, trackId: string): RemoveResult {
  getBlock(db, blockId);
  return db.transaction(() => {
    const res = db.prepare('DELETE FROM block_items WHERE block_id = ? AND track_id = ?').run(blockId, trackId);
    if (res.changes === 0) {
      throw new ApiError(404, 'track_not_in_block', 'Track ist nicht in diesem Block.');
    }
    return cleanupBlock(db, blockId);
  })();
}

export function addTrackToBlock(
  db: DB,
  blockId: string,
  trackId: string,
): BlockWithItems {
  const block = getBlock(db, blockId);
  const inPlaylist = playlistTrackIds(db, block.playlist_id);
  if (!inPlaylist.has(trackId)) {
    throw new ApiError(400, 'track_not_in_playlist', 'Track gehört nicht zu dieser Playlist.');
  }
  return db.transaction(() => {
    const max = (
      db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM block_items WHERE block_id = ?').get(blockId) as {
        m: number;
      }
    ).m;
    db.prepare(
      'INSERT OR IGNORE INTO block_items (block_id, track_id, position) VALUES (?, ?, ?)',
    ).run(blockId, trackId, max + 1);
    return getBlockWithItems(db, blockId);
  })();
}

export function deleteBlock(db: DB, blockId: string): void {
  getBlock(db, blockId);
  db.prepare('DELETE FROM blocks WHERE id = ?').run(blockId);
}
