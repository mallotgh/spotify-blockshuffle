import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './lib/api';
import { useToast, errorText } from './lib/toast';
import type { ShuffleRun } from './types';
import LoginScreen from './components/LoginScreen';
import Header from './components/Header';
import PlaylistSidebar from './components/PlaylistSidebar';
import Workspace from './components/Workspace';
import PreviewModal from './components/PreviewModal';
import StatusBar from './components/StatusBar';

export default function App() {
  const queryClient = useQueryClient();
  const auth = useQuery({ queryKey: ['auth'], queryFn: api.authStatus });

  // Vom API-Wrapper gemeldet, wenn die Session serverseitig weg ist -> Login-Screen
  useEffect(() => {
    const onExpired = () => queryClient.invalidateQueries({ queryKey: ['auth'] });
    window.addEventListener('auth-expired', onExpired);
    return () => window.removeEventListener('auth-expired', onExpired);
  }, [queryClient]);

  if (auth.isLoading) {
    return <Center>Lade&nbsp;…</Center>;
  }
  if (auth.isError) {
    return <Center>Server nicht erreichbar. Läuft das Backend?</Center>;
  }
  if (!auth.data?.authenticated) {
    return <LoginScreen />;
  }
  return <MainApp displayName={auth.data.user?.displayName ?? auth.data.user?.id ?? 'Spotify-Account'} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-neutral-400">{children}</div>;
}

function MainApp({ displayName }: { displayName: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | undefined>(
    () => localStorage.getItem('deviceId') ?? undefined,
  );
  const [previewRun, setPreviewRun] = useState<ShuffleRun | null>(null);
  const [busy, setBusy] = useState(false);

  const selectDevice = useCallback((id: string | undefined) => {
    setDeviceId(id);
    if (id) localStorage.setItem('deviceId', id);
    else localStorage.removeItem('deviceId');
  }, []);

  const runShuffle = useCallback(
    async (opts: { preview: boolean; seed?: string }) => {
      if (!playlistId) return;
      setBusy(true);
      try {
        const run = await api.shuffle(playlistId, opts.seed);
        if (run.skippedOrphans && run.skippedOrphans.length > 0) {
          toast('info', `${run.skippedOrphans.length} verwaiste Blockeinträge wurden übersprungen.`);
        }
        if (opts.preview) {
          setPreviewRun(run);
        } else {
          await api.play(run.runId, deviceId);
          toast('info', `Wiedergabe gestartet (Seed ${run.seed}).`);
        }
        // Sync könnte die Trackliste verändert haben
        queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      } catch (err) {
        toast('error', errorText(err));
      } finally {
        setBusy(false);
      }
    },
    [playlistId, deviceId, queryClient, toast],
  );

  const playRun = useCallback(
    async (run: ShuffleRun) => {
      setBusy(true);
      try {
        await api.play(run.runId, deviceId);
        toast('info', `Wiedergabe gestartet (Seed ${run.seed}).`);
        setPreviewRun(null);
      } catch (err) {
        toast('error', errorText(err));
      } finally {
        setBusy(false);
      }
    },
    [deviceId, toast],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
    queryClient.clear();
    location.reload();
  }, [queryClient]);

  return (
    <div className="flex h-full flex-col">
      <Header
        displayName={displayName}
        deviceId={deviceId}
        onSelectDevice={selectDevice}
        canShuffle={playlistId !== null && !busy}
        onStart={() => runShuffle({ preview: false })}
        onPreview={() => runShuffle({ preview: true })}
        onLogout={logout}
      />
      <div className="flex min-h-0 flex-1">
        {/* Mobil: entweder Liste oder Arbeitsbereich; ab md beides nebeneinander */}
        <div className={`${playlistId ? 'hidden md:flex' : 'flex'} w-full md:w-80`}>
          <PlaylistSidebar selectedId={playlistId} onSelect={setPlaylistId} />
        </div>
        <main className={`${playlistId ? 'block' : 'hidden md:block'} min-w-0 flex-1 overflow-y-auto`}>
          {playlistId ? (
            <Workspace playlistId={playlistId} onBack={() => setPlaylistId(null)} />
          ) : (
            <Center>Wähle links eine Playlist aus.</Center>
          )}
        </main>
      </div>
      <StatusBar />
      {previewRun && (
        <PreviewModal
          run={previewRun}
          busy={busy}
          onClose={() => setPreviewRun(null)}
          onReshuffle={(seed) => runShuffle({ preview: true, seed })}
          onPlay={() => playRun(previewRun)}
        />
      )}
    </div>
  );
}
