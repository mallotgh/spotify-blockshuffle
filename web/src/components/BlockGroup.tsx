import { useEffect, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../lib/api';
import type { Block, BlockItem, PlaylistDetail } from '../types';
import { formatDuration } from './Workspace';

interface Props {
  block: Block;
  onChange: (detail: PlaylistDetail) => void;
  withForceConfirm: (
    fn: (force: boolean) => Promise<{ detail: PlaylistDetail }>,
  ) => Promise<boolean>;
}

export default function BlockGroup({ block, onChange }: Props) {
  const [items, setItems] = useState<BlockItem[]>(block.items);
  const [editingName, setEditingName] = useState<string | null>(null);

  useEffect(() => setItems(block.items), [block.items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.trackId === active.id);
    const newIndex = items.findIndex((i) => i.trackId === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(items, oldIndex, newIndex);
    setItems(reordered);
    try {
      const res = await api.setBlockItems(block.id, reordered.map((i) => i.trackId));
      onChange(res.detail);
    } catch {
      setItems(block.items);
    }
  };

  const rename = async () => {
    const name = editingName?.trim();
    setEditingName(null);
    if (!name || name === block.name) return;
    const res = await api.renameBlock(block.id, name);
    onChange(res.detail);
  };

  const dissolve = async () => {
    if (!window.confirm(`Block „${block.name}" auflösen? Die Tracks bleiben in der Playlist.`)) return;
    const res = await api.deleteBlock(block.id);
    onChange(res.detail);
  };

  const removeTrack = async (trackId: string) => {
    const res = await api.removeTrackFromBlock(block.id, trackId);
    onChange(res.detail);
  };

  return (
    <section
      className="rounded-lg border-l-4 bg-neutral-900/80 py-1"
      style={{ borderLeftColor: block.color, backgroundColor: `${block.color}14` }}
    >
      <div className="flex items-center gap-2 px-3 py-1">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: block.color }} />
        {editingName !== null ? (
          <input
            autoFocus
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') rename();
              if (e.key === 'Escape') setEditingName(null);
            }}
            className="rounded border border-neutral-600 bg-neutral-800 px-2 py-0.5 text-sm"
          />
        ) : (
          <button
            onClick={() => setEditingName(block.name)}
            title="Block umbenennen"
            className="truncate text-sm font-semibold hover:underline"
          >
            {block.name}
          </button>
        )}
        <span className="text-xs text-neutral-500">{items.length} Tracks</span>
        <button
          onClick={dissolve}
          title="Block auflösen"
          className="ml-auto rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
        >
          Auflösen
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.trackId)} strategy={verticalListSortingStrategy}>
          <ul>
            {items.map((item, index) => (
              <SortableTrack
                key={item.trackId}
                item={item}
                isOriginal={index === 0}
                onRemove={() => removeTrack(item.trackId)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
}

function SortableTrack({
  item,
  isOriginal,
  onRemove,
}: {
  item: BlockItem;
  isOriginal: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.trackId,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 px-3 py-1.5 ${isDragging ? 'z-10 opacity-70' : ''} ${
        item.orphaned ? 'opacity-40' : ''
      }`}
    >
      <span
        {...attributes}
        {...listeners}
        title="Ziehen, um die Reihenfolge im Block zu ändern"
        className="cursor-grab touch-none select-none text-neutral-600 hover:text-neutral-300"
      >
        ⠿
      </span>
      {item.track?.imageUrl ? (
        <img src={item.track.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-9 w-9 shrink-0 rounded bg-neutral-800" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm">{item.track?.name ?? item.trackId}</span>
          {isOriginal && (
            <span className="shrink-0 rounded bg-neutral-700 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-neutral-300">
              Original
            </span>
          )}
          {item.orphaned && (
            <span
              className="shrink-0 rounded bg-amber-900 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-200"
              title="Dieser Track ist nicht mehr in der Spotify-Playlist. Beim Shuffle wird er übersprungen. Entfernen oder Playlist wiederherstellen."
            >
              verwaist
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-neutral-500">
          {item.track?.artists.join(', ') ?? 'Unbekannt'}
        </span>
      </span>
      {item.track && (
        <span className="shrink-0 text-xs tabular-nums text-neutral-500">
          {formatDuration(item.track.durationMs)}
        </span>
      )}
      <button
        onClick={onRemove}
        title="Aus dem Block entfernen"
        className="shrink-0 rounded px-1.5 text-neutral-600 hover:bg-neutral-800 hover:text-red-400"
      >
        ✕
      </button>
    </li>
  );
}
