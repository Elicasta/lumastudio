import type { Setlist, Song } from "./types";
import type { PadSlot } from "../services/pads";
import type { VideoProgram } from "./video";

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
    video: { clips: [], output: { displayEnabled: false, ndiEnabled: false, ndiName: "LumaRig Studio Program" } },
    lightingBindings: {}
  };
}

export function serializeProject(project: StudioProject) {
  return JSON.stringify({ ...project, updatedAt: new Date().toISOString() }, null, 2);
}

export function parseProject(raw: string): StudioProject {
  const value = JSON.parse(raw) as Partial<StudioProject>;
  if (value.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new Error("Unsupported LumaRig Studio project version.");
  if (!value.id || !value.name || !value.setlist) throw new Error("Invalid LumaRig Studio project.");
  return value as StudioProject;
}
