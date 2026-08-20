import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDuration } from './Workspace';

export default function StatusBar() {
  const status = useQuery({
    queryKey: ['playerStatus'],
    queryFn: api.playerStatus,
    // Ohne aktive Wiedergabe reicht ein langsamer Takt — schont Spotifys Rate-Limit
    refetchInterval: (query) => (query.state.data?.active ? 5000 : 30_000),
    retry: false,
  });

  const s = status.data;

  return (
    <footer className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-800 bg-neutral-900 px-4 py-1.5 text-sm">
      {!s?.active || !s.track ? (
        <span className="text-neutral-500">Keine aktive Wiedergabe.</span>
      ) : (
        <>
          {s.track.imageUrl && (
            <img src={s.track.imageUrl} alt="" className="h-7 w-7 rounded object-cover" />
          )}
          <span className="min-w-0 max-w-md truncate">
            <span className={s.isPlaying ? '' : 'text-neutral-500'}>
              {s.isPlaying ? '▶' : '⏸'} {s.track.name}
            </span>
            <span className="text-neutral-500"> — {s.track.artists.join(', ')}</span>
          </span>
          <span className="text-xs tabular-nums text-neutral-500">
            {formatDuration(s.progressMs ?? 0)} / {formatDuration(s.track.durationMs)}
          </span>
          {s.run && (
            <span
              className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300"
              title={`Playlist: ${s.run.playlistName ?? '–'} · Seed ${s.run.seed}${s.run.blockName ? ` · Block „${s.run.blockName}"` : ''}`}
            >
              Block {s.run.blockIndex} von {s.run.blockCount} · Track {s.run.trackInBlock} von{' '}
              {s.run.blockSize}
            </span>
          )}
          {s.device && <span className="text-xs text-neutral-500">auf {s.device.name}</span>}
          {s.shuffleWarning && (
            <span className="rounded bg-amber-900 px-2 py-0.5 text-xs font-semibold text-amber-200">
              ⚠ Spotify-Shuffle ist aktiv — die Blockreihenfolge wird dadurch zerstört. In Spotify
              den Shuffle ausschalten.
            </span>
          )}
        </>
      )}
    </footer>
  );
}
