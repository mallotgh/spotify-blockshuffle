import { z } from 'zod';

/**
 * Schemata für die Spotify Web API nach dem Umbau vom Februar 2026:
 * - Playlist-Inhalte liegen unter `items` (statt `tracks`), Einträge unter `item` (statt `track`)
 * - `available_markets`, `popularity`, `linked_from` und `product` (GET /me) existieren nicht mehr
 * Nur die Felder, die wir tatsächlich nutzen — alles Weitere wird ignoriert.
 */

const imageSchema = z.object({
  url: z.string(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
});

export const userProfileSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable().optional(),
});

export const simplifiedPlaylistSchema = z.object({
  id: z.string(),
  name: z.string(),
  snapshot_id: z.string().optional(),
  images: z.array(imageSchema).nullable().optional(),
  owner: z.object({ id: z.string() }),
  items: z.object({ total: z.number() }).optional(),
});

export const playlistPageSchema = z.object({
  items: z.array(simplifiedPlaylistSchema.nullable()),
  next: z.string().nullable(),
});

export const trackSchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  duration_ms: z.number(),
  type: z.string().optional(),
  artists: z.array(z.object({ name: z.string() })).default([]),
  album: z
    .object({
      name: z.string(),
      images: z.array(imageSchema).nullable().optional(),
    })
    .optional(),
});

export const playlistItemEntrySchema = z.object({
  is_local: z.boolean().optional(),
  // Seit Februar 2026 heißt das Feld `item`; `track` existiert nur noch als
  // deprecatetes Alias und wird hier bewusst nicht gelesen.
  item: trackSchema.nullable(),
});

export const playlistItemsPageSchema = z.object({
  items: z.array(playlistItemEntrySchema),
  next: z.string().nullable(),
});

export const playlistMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  snapshot_id: z.string().optional(),
  images: z.array(imageSchema).nullable().optional(),
  owner: z.object({ id: z.string() }),
});

export const createdPlaylistSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const snapshotSchema = z.object({ snapshot_id: z.string() });

export const deviceSchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  is_active: z.boolean(),
  is_restricted: z.boolean().optional(),
  volume_percent: z.number().nullable().optional(),
});

export const devicesResponseSchema = z.object({ devices: z.array(deviceSchema) });

export const playerStateSchema = z.object({
  device: deviceSchema.optional(),
  shuffle_state: z.boolean().optional(),
  is_playing: z.boolean().optional(),
  progress_ms: z.number().nullable().optional(),
  context: z.object({ type: z.string(), uri: z.string() }).nullable().optional(),
  item: trackSchema.nullable().optional(),
});

export type SpotifyTrack = z.infer<typeof trackSchema>;
