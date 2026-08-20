import { describe, it, expect } from 'vitest';
import { blockShuffle, type ShuffleInput } from '../src/shuffle/engine.js';

const tracks = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

describe('blockShuffle', () => {
  it('leere Playlist ergibt leere Reihenfolge', () => {
    const result = blockShuffle({ playlistOrder: [], blocks: [] }, 'seed');
    expect(result.order).toEqual([]);
    expect(result.units).toEqual([]);
    expect(result.skippedOrphans).toEqual([]);
  });

  it('Playlist ohne Blöcke: Permutation aller Tracks', () => {
    const order = tracks(20);
    const result = blockShuffle({ playlistOrder: order, blocks: [] }, 'abc');
    expect([...result.order].sort()).toEqual([...order].sort());
    expect(result.units).toHaveLength(20);
    expect(result.units.every((u) => u.blockId === null && u.trackIds.length === 1)).toBe(true);
  });

  it('ein Block umfasst alle Tracks: Reihenfolge exakt die Blockreihenfolge', () => {
    const blockOrder = ['t3', 't0', 't2', 't1'];
    const input: ShuffleInput = {
      playlistOrder: tracks(4),
      blocks: [{ id: 'b1', name: 'Alles', trackIds: blockOrder }],
    };
    for (const seed of ['a', 'b', 'c']) {
      const result = blockShuffle(input, seed);
      expect(result.order).toEqual(blockOrder);
      expect(result.units).toHaveLength(1);
    }
  });

  it('verwaiste Blockeinträge werden übersprungen und gemeldet', () => {
    const input: ShuffleInput = {
      playlistOrder: ['t0', 't1', 't2'],
      blocks: [{ id: 'b1', name: 'B', trackIds: ['t1', 'ghost', 't2'] }],
    };
    const result = blockShuffle(input, 'seed');
    expect(result.skippedOrphans).toEqual([{ blockId: 'b1', trackId: 'ghost' }]);
    expect(result.order).not.toContain('ghost');
    expect([...result.order].sort()).toEqual(['t0', 't1', 't2']);
    // Blockreihenfolge ohne den Verwaisten bleibt erhalten
    const blockUnit = result.units.find((u) => u.blockId === 'b1')!;
    expect(blockUnit.trackIds).toEqual(['t1', 't2']);
  });

  it('Seed reproduziert die Reihenfolge exakt', () => {
    const input: ShuffleInput = {
      playlistOrder: tracks(50),
      blocks: [
        { id: 'b1', name: 'B1', trackIds: ['t5', 't6', 't7'] },
        { id: 'b2', name: 'B2', trackIds: ['t20', 't10'] },
      ],
    };
    const a = blockShuffle(input, 'deadbeef');
    const b = blockShuffle(input, 'deadbeef');
    const c = blockShuffle(input, 'cafebabe');
    expect(a.order).toEqual(b.order);
    expect(a.order).not.toEqual(c.order);
  });

  it('1000 Durchläufe: Blockreihenfolge bleibt in 100 % erhalten, Blockposition annähernd gleichverteilt', () => {
    // 1 Block (3 Tracks) + 4 Einzeltracks -> 5 Einheiten
    const input: ShuffleInput = {
      playlistOrder: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      blocks: [{ id: 'blk', name: 'B', trackIds: ['b', 'c', 'd'] }],
    };
    const runs = 1000;
    const unitPositionCounts = new Array<number>(5).fill(0);
    for (let i = 0; i < runs; i++) {
      const result = blockShuffle(input, `seed-${i}`);
      // Blocktracks müssen zusammenhängend und in fester Reihenfolge auftauchen
      const idx = result.order.indexOf('b');
      expect(result.order.slice(idx, idx + 3)).toEqual(['b', 'c', 'd']);
      const unitIdx = result.units.findIndex((u) => u.blockId === 'blk');
      unitPositionCounts[unitIdx]!++;
    }
    // Erwartung 200 pro Position; großzügige Toleranz gegen Zufallsrauschen
    for (const count of unitPositionCounts) {
      expect(count).toBeGreaterThan(140);
      expect(count).toBeLessThan(260);
    }
  });

  it('doppelte Tracks ohne Block bleiben als einzelne Einheiten erhalten', () => {
    const result = blockShuffle({ playlistOrder: ['x', 'y', 'x'], blocks: [] }, 's');
    expect([...result.order].sort()).toEqual(['x', 'x', 'y']);
  });

  it('ein Track in zwei Blöcken spielt einmal pro Block', () => {
    const result = blockShuffle(
      {
        playlistOrder: ['a', 'b', 'c', 'd'],
        blocks: [
          { id: 'b1', name: 'B1', trackIds: ['a', 'b'] },
          { id: 'b2', name: 'B2', trackIds: ['b', 'c'] },
        ],
      },
      's',
    );
    // b steckt in beiden Blöcken -> insgesamt 5 Abspielpositionen
    expect(result.order).toHaveLength(5);
    expect([...result.order].sort()).toEqual(['a', 'b', 'b', 'c', 'd']);
    expect(result.units.find((u) => u.blockId === 'b1')!.trackIds).toEqual(['a', 'b']);
    expect(result.units.find((u) => u.blockId === 'b2')!.trackIds).toEqual(['b', 'c']);
    // d bleibt als einzige Einzel-Einheit übrig
    expect(result.units.filter((u) => u.blockId === null).flatMap((u) => u.trackIds)).toEqual(['d']);
  });

  it('ein Block konsumiert nur das erste Vorkommen eines doppelten Tracks', () => {
    const result = blockShuffle(
      { playlistOrder: ['a', 'b', 'a', 'c'], blocks: [{ id: 'b1', name: 'B', trackIds: ['a', 'c'] }] },
      's',
    );
    expect(result.order).toHaveLength(4);
    expect([...result.order].sort()).toEqual(['a', 'a', 'b', 'c']);
    expect(result.units.find((u) => u.blockId === 'b1')!.trackIds).toEqual(['a', 'c']);
  });
});
