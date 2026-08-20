import type {
  AuthStatus,
  Block,
  Device,
  PlayerStatus,
  PlaylistDetail,
  PlaylistSummary,
  ShuffleRun,
} from '../types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
  });
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      /* Kein JSON */
    }
  }
  if (!res.ok) {
    const err = (body ?? {}) as { error?: string; message?: string; details?: unknown };
    throw new ApiError(
      res.status,
      err.error ?? 'unknown',
      err.message ?? `Serverfehler (HTTP ${res.status})`,
      err.details,
    );
  }
  return body as T;
}

export const api = {
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  playlists: (refresh = false) =>
    request<{ playlists: PlaylistSummary[] }>(`/api/playlists${refresh ? '?refresh=1' : ''}`),
  playlistDetail: (id: string, refresh = false) =>
    request<PlaylistDetail>(`/api/playlists/${id}${refresh ? '?refresh=1' : ''}`),

  createBlock: (playlistId: string, body: { trackIds: string[]; name?: string; force?: boolean }) =>
    request<{ block: Block; detail: PlaylistDetail }>(`/api/playlists/${playlistId}/blocks`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  renameBlock: (blockId: string, name: string) =>
    request<{ detail: PlaylistDetail }>(`/api/blocks/${blockId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  setBlockItems: (blockId: string, trackIds: string[], force = false) =>
    request<{ detail: PlaylistDetail }>(`/api/blocks/${blockId}/items`, {
      method: 'PUT',
      body: JSON.stringify({ trackIds, force }),
    }),
  addTrackToBlock: (blockId: string, trackId: string, force = false) =>
    request<{ detail: PlaylistDetail }>(`/api/blocks/${blockId}/items`, {
      method: 'POST',
      body: JSON.stringify({ trackId, force }),
    }),
  removeTrackFromBlock: (blockId: string, trackId: string) =>
    request<{ dissolved: boolean; detail: PlaylistDetail }>(
      `/api/blocks/${blockId}/items/${trackId}`,
      { method: 'DELETE' },
    ),
  deleteBlock: (blockId: string) =>
    request<{ ok: true; detail: PlaylistDetail }>(`/api/blocks/${blockId}`, { method: 'DELETE' }),

  shuffle: (playlistId: string, seed?: string) =>
    request<ShuffleRun>(`/api/playlists/${playlistId}/shuffle`, {
      method: 'POST',
      body: JSON.stringify(seed ? { seed } : {}),
    }),
  play: (runId: string, deviceId?: string) =>
    request<{ ok: true; mode: string }>(`/api/shuffle/${runId}/play`, {
      method: 'POST',
      body: JSON.stringify(deviceId ? { deviceId } : {}),
    }),

  devices: () => request<{ devices: Device[] }>('/api/player/devices'),
  playerStatus: () => request<PlayerStatus>('/api/player/status'),
};
