import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Props {
  displayName: string;
  deviceId: string | undefined;
  onSelectDevice: (id: string | undefined) => void;
  canShuffle: boolean;
  onStart: () => void;
  onPreview: () => void;
  onLogout: () => void;
}

export default function Header(props: Props) {
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: api.devices,
    refetchInterval: 30_000,
    retry: false,
  });

  const list = devices.data?.devices ?? [];
  const noDevices = devices.isSuccess && list.length === 0;

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4 py-3">
      <span className="text-lg font-bold">🔀 Blockshuffle</span>

      <div className="ml-auto flex flex-wrap items-center gap-3">
        <select
          value={props.deviceId ?? ''}
          onChange={(e) => props.onSelectDevice(e.target.value || undefined)}
          className="max-w-52 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm"
          title="Spotify-Connect-Gerät"
        >
          <option value="">Aktives Gerät</option>
          {list.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} {d.isActive ? '●' : ''}
            </option>
          ))}
        </select>

        <button
          onClick={props.onPreview}
          disabled={!props.canShuffle}
          className="rounded-md border border-neutral-600 px-3 py-1.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-40"
        >
          Vorschau
        </button>
        <button
          onClick={props.onStart}
          disabled={!props.canShuffle}
          className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-40"
        >
          Blockshuffle starten
        </button>

        <span className="hidden text-sm text-neutral-400 sm:inline" title="Verbundener Account">
          {props.displayName}
        </span>
        <button
          onClick={props.onLogout}
          className="text-sm text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
        >
          Abmelden
        </button>
      </div>

      {noDevices && (
        <p className="w-full text-xs text-amber-400">
          Kein Spotify-Gerät gefunden. Öffne Spotify auf einem Gerät und spiele kurz etwas ab, damit
          es hier auftaucht.
        </p>
      )}
    </header>
  );
}
