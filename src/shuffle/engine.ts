import { createRng, shuffleInPlace } from './rng.js';

/**
 * Reine Shuffle-Engine: keine Netzwerk- oder Datenbankzugriffe.
 *
 * Einheiten:
 *  - jeder definierte Block -> eine Einheit mit fester interner Reihenfolge
 *  - jeder Track ohne Blockzugehörigkeit -> Einheit der Länge 1
 * Die Einheitenliste wird per Fisher-Yates mit seedbarem RNG gemischt und
 * anschließend flach ausgerollt.
 */

export interface ShuffleBlock {
  id: string;
  name: string;
  /** Track-IDs in Blockreihenfolge. */
  trackIds: string[];
}

export interface ShuffleInput {
  /** Track-IDs in aktueller Playlist-Reihenfolge. */
  playlistOrder: string[];
  blocks: ShuffleBlock[];
}

export interface ShuffleUnit {
  blockId: string | null;
  blockName: string | null;
  trackIds: string[];
}

export interface ShuffleResult {
  seed: string;
  /** Gemischte Einheiten in finaler Reihenfolge. */
  units: ShuffleUnit[];
  /** Flache Track-Reihenfolge. */
  order: string[];
  /** Blockeinträge, die nicht (mehr) in der Playlist liegen und übersprungen wurden. */
  skippedOrphans: { blockId: string; trackId: string }[];
}

export function blockShuffle(input: ShuffleInput, seed: string): ShuffleResult {
  const inPlaylist = new Set(input.playlistOrder);
  const skippedOrphans: { blockId: string; trackId: string }[] = [];

  // Blöcke auf die tatsächlich vorhandenen Tracks reduzieren; Verwaiste protokollieren.
  const blockUnits: ShuffleUnit[] = [];
  const blockedTrackIds = new Set<string>();
  for (const block of input.blocks) {
    const present: string[] = [];
    for (const trackId of block.trackIds) {
      if (inPlaylist.has(trackId)) {
        present.push(trackId);
        blockedTrackIds.add(trackId);
      } else {
        skippedOrphans.push({ blockId: block.id, trackId });
      }
    }
    if (present.length > 0) {
      blockUnits.push({ blockId: block.id, blockName: block.name, trackIds: present });
    }
  }

  // Einheiten in Playlist-Reihenfolge aufbauen: Block-Einheiten an der Position
  // ihres ersten Tracks, alle übrigen Tracks als Einzel-Einheiten. Tracks, die
  // zu einem Block gehören, werden aus dem Einzelpool entfernt (inkl. Duplikate).
  const firstPos = new Map<string, number>();
  input.playlistOrder.forEach((trackId, pos) => {
    if (!firstPos.has(trackId)) firstPos.set(trackId, pos);
  });

  const units: { sortPos: number; unit: ShuffleUnit }[] = [];
  for (const unit of blockUnits) {
    const pos = Math.min(...unit.trackIds.map((t) => firstPos.get(t) ?? Number.MAX_SAFE_INTEGER));
    units.push({ sortPos: pos, unit });
  }
  // Pro Blockzugehörigkeit wird nur das erste Vorkommen konsumiert; taucht ein
  // Track mehrfach in der Playlist auf, bleiben die weiteren Vorkommen Einzel-Einheiten.
  const consumedByBlock = new Set<string>();
  input.playlistOrder.forEach((trackId, pos) => {
    if (blockedTrackIds.has(trackId) && !consumedByBlock.has(trackId)) {
      consumedByBlock.add(trackId);
      return;
    }
    units.push({ sortPos: pos, unit: { blockId: null, blockName: null, trackIds: [trackId] } });
  });
  units.sort((a, b) => a.sortPos - b.sortPos);

  const unitList = units.map((u) => u.unit);
  shuffleInPlace(unitList, createRng(seed));

  return {
    seed,
    units: unitList,
    order: unitList.flatMap((u) => u.trackIds),
    skippedOrphans,
  };
}
