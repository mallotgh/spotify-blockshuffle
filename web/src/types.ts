export interface AuthStatus {
  authenticated: boolean;
  user?: { id: string | null; displayName: string | null };
}

export interface PlaylistSummary {
  id: string;
  name: string;
  ownerId: string;
  imageUrl: string | null;
  trackTotal: number;
  itemsReadable: boolean;
  blockCount: number;
}

export interface TrackDto {
  id: string;
  name: string;
  artists: string[];
  albumName: string | null;
  imageUrl: string | null;
  durationMs: number;
}

export interface PlaylistTrack extends TrackDto {
  position: number;
  blockId: string | null;
}

export interface BlockItem {
  trackId: string;
  position: number;
  orphaned: boolean;
  track: TrackDto | null;
}

export interface Block {
  id: string;
  name: string;
  color: string;
  items: BlockItem[];
}

export interface PlaylistDetail {
  playlist: {
    id: string;
    name: string;
    ownerId: string;
    imageUrl: string | null;
    trackTotal: number;
    itemsReadable: boolean;
    lastSyncedAt: number | null;
  };
  tracks: PlaylistTrack[];
  blocks: Block[];
}

export interface ShuffleRun {
  runId: string;
  playlistId: string;
  seed: string;
  createdAt: number;
  trackCount: number;
  units: {
    blockId: string | null;
    blockName: string | null;
    tracks: { trackId: string; track: TrackDto | null }[];
  }[];
  skippedOrphans?: { blockId: string; trackId: string }[];
}

export interface Device {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface PlayerStatus {
  active: boolean;
  isPlaying?: boolean;
  progressMs?: number | null;
  shuffleWarning?: boolean;
  device?: { id: string | null; name: string } | null;
  track?: {
    id: string | null;
    name: string;
    artists: string[];
    durationMs: number;
    imageUrl: string | null;
  } | null;
  run?: {
    runId: string;
    playlistId: string;
    playlistName: string | null;
    seed: string;
    blockIndex: number;
    blockCount: number;
    blockName: string | null;
    blockId: string | null;
    trackInBlock: number;
    blockSize: number;
  } | null;
}
