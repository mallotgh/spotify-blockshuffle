import { useEffect, useState } from 'react';
import type { ShuffleRun } from '../types';
import { formatDuration } from './Workspace';

interface Props {
  run: ShuffleRun;
  busy: boolean;
  onClose: () => void;
  onReshuffle: (seed?: string) => void;
  onPlay: () => void;
}

export default function PreviewModal({ run, busy, onClose, onReshuffle, onPlay }: Props) {
  const [seedInput, setSeedInput] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  let runningIndex = 0;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Shuffle-Vorschau"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-5 py-3">
          <h3 className="text-lg font-bold">Vorschau</h3>
          <span className="text-sm text-neutral-400">
            {run.trackCount} Tracks · {run.units.length} Einheiten
          </span>
          <code
            className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-green-300"
            title="Seed – gleiche Eingabe reproduziert exakt diese Reihenfolge"
          >
            Seed {run.seed}
          </code>
          <button
            onClick={onClose}
            className="ml-auto rounded px-2 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            title="Schließen (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <ol className="flex flex-col gap-1">
            {run.units.map((unit, unitIdx) => (
              <li
                key={unitIdx}
                className={unit.blockId ? 'rounded-md border-l-4 border-green-600 bg-green-950/30 py-1' : ''}
              >
                {unit.blockId && (
                  <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-green-400">
                    {unit.blockName ?? 'Block'}
                  </p>
                )}
                {unit.tracks.map((t) => {
                  runningIndex++;
                  return (
                    <p key={`${runningIndex}`} className="flex gap-3 px-3 py-0.5 text-sm">
                      <span className="w-8 shrink-0 text-right tabular-nums text-neutral-600">
                        {runningIndex}.
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {t.track?.name ?? t.trackId}
                        <span className="text-neutral-500"> — {t.track?.artists.join(', ')}</span>
                      </span>
                      {t.track && (
                        <span className="shrink-0 text-xs tabular-nums text-neutral-600">
                          {formatDuration(t.track.durationMs)}
                        </span>
                      )}
                    </p>
                  );
                })}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-neutral-800 px-5 py-3">
          <input
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            placeholder="Seed (optional)"
            className="w-36 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm"
            title="Einen früheren Seed eingeben, um dessen Reihenfolge exakt zu reproduzieren"
          />
          <button
            onClick={() => onReshuffle(seedInput.trim() || undefined)}
            disabled={busy}
            className="rounded-md border border-neutral-600 px-3 py-1.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-40"
          >
            Neu würfeln
          </button>
          <button
            onClick={onPlay}
            disabled={busy}
            className="ml-auto rounded-md bg-green-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-40"
          >
            Abspielen
          </button>
        </div>
      </div>
    </div>
  );
}
