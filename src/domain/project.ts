import type { Setlist, Song } from "./types";
import type { PadSlot } from "../services/pads";
import type { VideoProgram } from "./video";
import { defaultMidiSettings, type MidiSettings } from "./midi";
import { defaultIntegrationSettings, type IntegrationSettings } from "./integrations";

export const PROJECT_SCHEMA_VERSION = 1;

export interface StudioProject {
  schemaVersion: number;
  id: string;
  name: string;
  setlist: Setlist;
  selectedSongId?: string;
  updatedAt: string;
  padCount?: 12 | 16;
  pads?: PadSlot[];
  video?: VideoProgram;
  midi?: MidiSettings;
  integrations?: IntegrationSettings;
  lightingBindings?: Record<string, {
    lumarigShowId: string;
    songId: string;
    songTitle: string;
    updatedAt: string;
  }>;
}

export function createProject(name: string, songs: Song[] = []): StudioProject {
  const id = crypto.randomUUID();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    name,
    setlist: { id: crypto.randomUUID(), name, songs },
    selectedSongId: songs[0]?.id,
    updatedAt: new Date().toISOString(),
    padCount: 12,
    pads: [],
    video: { clips: [], state: "live", output: { displayEnabled: false, ndiEnabled: false, ndiName: "LumaRig Studio Program" } },
    midi: defaultMidiSettings(),
    integrations: defaultIntegrationSettings(),
    lightingBindings: {}
  };
}

export function serializeProject(project: StudioProject) {
  return JSON.stringify({ ...project, updatedAt: new Date().toISOString() }, null, 2);
}

export function parseProject(raw: string): StudioProject {
  const value = JSON.parse(raw) as Partial<StudioProject>;
  if (value.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new Error("Unsupported LumaRig Studio project version.");
  if (typeof value.id !== "string" || !value.id || typeof value.name !== "string" || !value.name
    || !value.setlist || typeof value.setlist.id !== "string" || !Array.isArray(value.setlist.songs))
    throw new Error("Invalid LumaStudio project: missing service or running order.");
  const ids = new Set<string>();
  for (const song of value.setlist.songs) {
    if (!song || typeof song.id !== "string" || !song.id || ids.has(song.id)
      || typeof song.title !== "string" || !Array.isArray(song.tracks) || !Array.isArray(song.sections)
      || !Number.isFinite(song.bpm) || song.bpm <= 0
      || !Array.isArray(song.meter) || song.meter.length !== 2
      || !song.countIn || !song.manualJumpCountIn || !song.guideVoice || !Array.isArray(song.guideMarkers))
      throw new Error("Invalid LumaStudio project: a running-order item is incomplete or duplicated.");
    ids.add(song.id);
  }
  if (value.video && !Array.isArray(value.video.clips)) throw new Error("Invalid LumaStudio project: video collection is incomplete.");
  if (value.padCount !== undefined && value.padCount !== 12 && value.padCount !== 16) throw new Error("Invalid LumaStudio project: pad count is unsupported.");
  if (value.pads !== undefined) {
    if (!Array.isArray(value.pads) || value.pads.length > 16) throw new Error("Invalid LumaStudio project: pad collection is incomplete.");
    const padIds = new Set<string>();
    for (const pad of value.pads) {
      if (!pad || typeof pad.id !== "string" || !pad.id || padIds.has(pad.id)
        || typeof pad.name !== "string" || !pad.name
        || !["one-shot", "loop", "hold", "latch"].includes(pad.mode)
        || (pad.path !== undefined && typeof pad.path !== "string")
        || !Number.isFinite(pad.gainDb) || !Number.isFinite(pad.octave)
        || !Number.isFinite(pad.width) || pad.width < 0 || pad.width > 100
        || !Number.isFinite(pad.attackMs) || pad.attackMs < 0
        || !Number.isFinite(pad.releaseMs) || pad.releaseMs < 0) {
        throw new Error("Invalid LumaStudio project: a pad is incomplete, duplicated, or unsafe.");
      }
      padIds.add(pad.id);
    }
  }
  return {
    ...value,
    selectedSongId: ids.has(value.selectedSongId ?? "") ? value.selectedSongId : value.setlist.songs[0]?.id,
    midi: value.midi ?? defaultMidiSettings(),
    integrations: value.integrations ?? defaultIntegrationSettings()
  } as StudioProject;
}
