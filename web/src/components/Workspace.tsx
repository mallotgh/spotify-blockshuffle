import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast, errorText } from '../lib/toast';
import type { Block, PlaylistDetail, PlaylistTrack } from '../types';
import BlockGroup from './BlockGroup';

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface Props {
  playlistId: string;
}

export default function Workspace({ playlistId }: Props) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['playlist', playlistId],
    queryFn: () => api.playlistDetail(playlistId),
  });

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [addTarget, setAddTarget] = useState<string>('');

  // Auswahl beim Playlistwechsel zurücksetzen
  useEffect(() => {
    setSelection(new Set());
    setAnchor(null);
  }, [playlistId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Nicht auslösen, wenn ein Modal offen ist oder gerade ein Feld editiert wird
      if (document.querySelector('[role="dialog"]') || e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape') {
        setSelection(new Set());
        setAnchor(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sichtbare Reihenfolge aller Tracks (lose Zeilen + Blockgruppen an ihrer
  // ersten Position) — Grundlage für Shift-Klick-Bereiche über alles hinweg.
  const selectableIds = useMemo(() => {
    const d = detail.data;
    if (!d) return [] as string[];
    const blockById = new Map(d.blocks.map((b) => [b.id, b]));
    const renderedBlocks = new Set<string>();
    const order: string[] = [];
    for (const t of d.tracks) {
      if (t.blockId === null) {
        order.push(t.id);
      } else if (!renderedBlocks.has(t.blockId)) {
        renderedBlocks.add(t.blockId);
        for (const item of blockById.get(t.blockId)?.items ?? []) order.push(item.trackId);
      }
    }
    for (const b of d.blocks) {
      if (!renderedBlocks.has(b.id)) for (const item of b.items) order.push(item.trackId);
    }
    return order.filter((id, i) => order.indexOf(id) === i);
  }, [detail.data]);

  const handleTrackClick = useCallback(
    (trackId: string, shiftKey: boolean) => {
      setSelection((prev) => {
        if (shiftKey && anchor !== null) {
          const a = selectableIds.indexOf(anchor);
          const b = selectableIds.indexOf(trackId);
          if (a >= 0 && b >= 0) {
            return new Set(selectableIds.slice(Math.min(a, b), Math.max(a, b) + 1));
          }
        }
        const next = new Set(prev);
        if (next.has(trackId)) next.delete(trackId);
        else next.add(trackId);
        return next;
      });
      if (!shiftKey) setAnchor(trackId);
    },
    [anchor, selectableIds],
  );

  const applyDetail = useCallback(
    (d: PlaylistDetail) => {
      queryClient.setQueryData(['playlist', playlistId], d);
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
    },
    [queryClient, playlistId],
  );

  /** Führt eine Blockänderung aus, übernimmt das Ergebnis und meldet Fehler als Toast. */
  const runMutation = useCallback(
    async (fn: () => Promise<{ detail: PlaylistDetail }>) => {
      try {
        const res = await fn();
        applyDetail(res.detail);
        return true;
      } catch (err) {
        toast('error', errorText(err));
        return false;
      }
    },
    [applyDetail, toast],
  );

  const createBlock = useCallback(async () => {
    const trackIds = [...selection];
    const ok = await runMutation(() => api.createBlock(playlistId, { trackIds }));
    if (ok) {
      setSelection(new Set());
      setAnchor(null);
    }
  }, [playlistId, selection, runMutation]);

  const addSelectionToBlock = useCallback(async () => {
    const block = detail.data?.blocks.find((b) => b.id === addTarget);
    if (!block) return;
    // Ein gebündelter Aufruf statt einem Request pro Track
    const existing = block.items.map((i) => i.trackId);
    const merged = [...existing, ...[...selection].filter((t) => !existing.includes(t))];
    const ok = await runMutation(() => api.setBlockItems(block.id, merged));
    if (ok) {
      setSelection(new Set());
      setAnchor(null);
    }
  }, [addTarget, detail.data, selection, runMutation]);

  if (detail.isLoading) {
    return <p className="p-6 text-neutral-500">Lade Trackliste …</p>;
  }
  if (detail.isError) {
    return <p className="p-6 text-red-400">{errorText(detail.error)}</p>;
  }
  const data = detail.data!;

  if (!data.playlist.itemsReadable) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-bold">{data.playlist.name}</h2>
        <p className="mt-4 max-w-lg rounded-lg border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200">
          Für fremde (nur gefolgte) Playlists liefert Spotify seit Februar 2026 keine Tracklisten
          mehr — hier sind nur Metadaten sichtbar. Blockshuffle funktioniert nur mit eigenen
          Playlists oder solchen, an denen du mitarbeitest.
        </p>
      </div>
    );
  }

  const blockById = new Map<string, Block>(data.blocks.map((b) => [b.id, b]));
  const rendered = new Set<string>();
  const rows: React.ReactNode[] = [];
  for (const track of data.tracks) {
    if (track.blockId === null) {
      rows.push(
        <TrackRow
          key={`pos-${track.position}`}
          track={track}
          selected={selection.has(track.id)}
          onClick={(e) => handleTrackClick(track.id, e.shiftKey)}
        />,
      );
    } else if (!rendered.has(track.blockId)) {
      rendered.add(track.blockId);
      const block = blockById.get(track.blockId);
      if (block) {
        rows.push(
          <BlockGroup
          key={block.id}
          block={block}
          onChange={applyDetail}
          selection={selection}
          onTrackClick={handleTrackClick}
        />,
        );
      }
    }
  }
  // Blöcke, deren Tracks komplett aus der Playlist verschwunden sind
  for (const block of data.blocks) {
    if (!rendered.has(block.id)) {
      rows.push(
        <BlockGroup
          key={block.id}
          block={block}
          onChange={applyDetail}
          selection={selection}
          onTrackClick={handleTrackClick}
        />,
      );
    }
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-xl font-bold">{data.playlist.name}</h2>
        <span className="text-sm text-neutral-500">
          {data.tracks.length} Tracks · {data.blocks.length} Blöcke
        </span>
        <button
          onClick={() =>
            queryClient.fetchQuery({
              queryKey: ['playlist', playlistId],
              queryFn: () => api.playlistDetail(playlistId, true),
            })
          }
          disabled={detail.isFetching}
          title="Trackliste neu von Spotify laden"
          className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
        >
          {detail.isFetching ? '…' : '↻'}
        </button>
      </div>

      {selection.size > 0 && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-green-800 bg-neutral-900/95 px-4 py-2 shadow">
          <span className="text-sm text-neutral-300">{selection.size} ausgewählt</span>
          <button
            onClick={createBlock}
            disabled={selection.size < 2}
            title={selection.size < 2 ? 'Ein Block braucht mindestens 2 Tracks' : undefined}
            className="rounded-md bg-green-700 px-3 py-1 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-40"
          >
            Block erstellen
          </button>
          {data.blocks.length > 0 && (
            <span className="flex items-center gap-1">
              <select
                value={addTarget}
                onChange={(e) => setAddTarget(e.target.value)}
                className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm"
              >
                <option value="">Block wählen …</option>
                {data.blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button
                onClick={addSelectionToBlock}
                disabled={!addTarget}
                className="rounded-md border border-neutral-600 px-2 py-1 text-sm hover:bg-neutral-800 disabled:opacity-40"
              >
                Hinzufügen
              </button>
            </span>
          )}
          <button
            onClick={() => {
              setSelection(new Set());
              setAnchor(null);
            }}
            className="ml-auto text-sm text-neutral-500 hover:text-neutral-300"
          >
            Auswahl aufheben (Esc)
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1">{rows}</div>
    </div>
  );
}

function TrackRow({
  track,
  selected,
  onClick,
}: {
  track: PlaylistTrack;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex select-none items-center gap-3 rounded-md px-3 py-1.5 text-left transition ${
        selected ? 'bg-green-900/50 ring-1 ring-green-600' : 'hover:bg-neutral-800/70'
      }`}
    >
      {track.imageUrl ? (
        <img src={track.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-9 w-9 shrink-0 rounded bg-neutral-800" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{track.name}</span>
        <span className="block truncate text-xs text-neutral-500">{track.artists.join(', ')}</span>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-neutral-500">
        {formatDuration(track.durationMs)}
      </span>
    </button>
  );
}
