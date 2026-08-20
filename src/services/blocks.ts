import crypto from 'node:crypto';
import type { DB } from '../db.js';
import { ApiError } from '../errors.js';

/**
 * Invarianten (werden hier serverseitig erzwungen):
 *  - Ein Track gehört pro Playlist zu höchstens einem Block.
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

/** Liefert für jeden Track der Playlist den Block, in dem er steckt. */
function blockMembership(db: DB, playlistId: string): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT bi.track_id, bi.block_id FROM block_items bi
       JOIN blocks b ON b.id = bi.block_id WHERE b.playlist_id = ?`,
    )
    .all(playlistId) as { track_id: string; block_id: string }[];
  return new Map(rows.map((r) => [r.track_id, r.block_id]));
}

export function getBlocks(db: DB, playlistId: string): BlockWithItems[] {
  const inPlaylist = playlistTrackIds(db, playlistId);
  const blocks = db
    .prepare('SELECT * FROM blocks WHERE playlist_id = ? ORDER BY created_at, id')
    .all(playlistId) as BlockRow[];
  return blocks.map((b) => ({
    ...b,
    items: (
      db
        .prepare('SELECT track_id, position FROM block_items WHERE block_id = ? ORDER BY position')
        .all(b.id) as { track_id: string; position: number }[]
    ).map((i) => ({ trackId: i.track_id, position: i.position, orphaned: !inPlaylist.has(i.track_id) })),
  }));
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

/**
 * Wirft 409 mit Konfliktdetails, wenn Tracks bereits in anderen Blöcken stecken.
 * Mit force=true werden sie stattdessen aus ihren bisherigen Blöcken entfernt
 * (explizite Bestätigung durch den Nutzer).
 */
function resolveConflicts(
  db: DB,
  playlistId: string,
  trackIds: string[],
  ignoreBlockId: string | null,
  force: boolean,
): void {
  const membership = blockMembership(db, playlistId);
  const conflicts = trackIds
    .map((t) => ({ trackId: t, blockId: membership.get(t) }))
    .filter((c): c is { trackId: string; blockId: string } => !!c.blockId && c.blockId !== ignoreBlockId);
  if (conflicts.length === 0) return;
  if (!force) {
    throw new ApiError(
      409,
      'track_in_other_block',
      'Mindestens ein Track gehört bereits zu einem anderen Block.',
      { conflicts },
    );
  }
  for (const c of conflicts) {
    removeTrackFromBlock(db, c.blockId, c.trackId);
  }
}

export function createBlock(
  db: DB,
  playlistId: string,
  trackIds: string[],
  opts: { name?: string; color?: string; force?: boolean } = {},
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
    resolveConflicts(db, playlistId, unique, null, opts.force ?? false);
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
    return getBlocks(db, playlistId).find((b) => b.id === id)!;
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
  opts: { force?: boolean } = {},
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
    const added = unique.filter((t) => !current.has(t));
    resolveConflicts(db, block.playlist_id, added, blockId, opts.force ?? false);
    db.prepare('DELETE FROM block_items WHERE block_id = ?').run(blockId);
    const insert = db.prepare('INSERT INTO block_items (block_id, track_id, position) VALUES (?, ?, ?)');
    unique.forEach((t, i) => insert.run(blockId, t, i));
    return getBlocks(db, block.playlist_id).find((b) => b.id === blockId)!;
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
    const rest = db
      .prepare('SELECT track_id FROM block_items WHERE block_id = ? ORDER BY position')
      .all(blockId) as { track_id: string }[];
    if (rest.length < 2) {
      db.prepare('DELETE FROM blocks WHERE id = ?').run(blockId);
      return { dissolved: true };
    }
    // Positionen lückenlos halten
    const update = db.prepare('UPDATE block_items SET position = ? WHERE block_id = ? AND track_id = ?');
    rest.forEach((r, i) => update.run(i, blockId, r.track_id));
    return { dissolved: false };
  })();
}

export function addTrackToBlock(
  db: DB,
  blockId: string,
  trackId: string,
  opts: { force?: boolean } = {},
): BlockWithItems {
  const block = getBlock(db, blockId);
  const inPlaylist = playlistTrackIds(db, block.playlist_id);
  if (!inPlaylist.has(trackId)) {
    throw new ApiError(400, 'track_not_in_playlist', 'Track gehört nicht zu dieser Playlist.');
  }
  return db.transaction(() => {
    resolveConflicts(db, block.playlist_id, [trackId], blockId, opts.force ?? false);
    const max = (
      db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM block_items WHERE block_id = ?').get(blockId) as {
        m: number;
      }
    ).m;
    db.prepare(
      'INSERT OR IGNORE INTO block_items (block_id, track_id, position) VALUES (?, ?, ?)',
    ).run(blockId, trackId, max + 1);
    return getBlocks(db, block.playlist_id).find((b) => b.id === blockId)!;
  })();
}

export function deleteBlock(db: DB, blockId: string): void {
  getBlock(db, blockId);
  db.prepare('DELETE FROM blocks WHERE id = ?').run(blockId);
}
