import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function PlaylistSidebar({ selectedId, onSelect }: Props) {
  const queryClient = useQueryClient();
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: () => api.playlists() });

  const refresh = async () => {
    await queryClient.fetchQuery({ queryKey: ['playlists'], queryFn: () => api.playlists(true) });
  };

  return (
    <aside className="flex w-full flex-col border-r border-neutral-800 bg-neutral-900/60 md:w-80 md:shrink-0">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Playlists</h2>
        <button
          onClick={refresh}
          disabled={playlists.isFetching}
          title="Playlists neu von Spotify laden"
          className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
        >
          {playlists.isFetching ? '…' : '↻'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {playlists.isLoading && <p className="px-4 py-2 text-sm text-neutral-500">Lade Playlists …</p>}
        {playlists.isError && (
          <p className="px-4 py-2 text-sm text-red-400">Playlists konnten nicht geladen werden.</p>
        )}
        <ul>
          {playlists.data?.playlists.map((pl) => (
            <li key={pl.id}>
              <button
                onClick={() => onSelect(pl.id)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-neutral-800 ${
                  selectedId === pl.id ? 'bg-neutral-800' : ''
                }`}
              >
                {pl.imageUrl ? (
                  <img src={pl.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-neutral-700 text-lg">
                    🎵
                  </div>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{pl.name}</span>
                  <span className="block text-xs text-neutral-500">
                    {pl.trackTotal} Tracks
                    {!pl.itemsReadable && ' · nur Metadaten'}
                  </span>
                </span>
                {pl.blockCount > 0 && (
                  <span
                    className="shrink-0 rounded-full bg-green-900 px-2 py-0.5 text-xs font-semibold text-green-300"
                    title={`${pl.blockCount} Blöcke definiert`}
                  >
                    {pl.blockCount}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
