import type { Setlist, Song } from "./types";

export const PROJECT_SCHEMA_VERSION = 1;

export interface StudioProject {
  schemaVersion: number;
  id: string;
  name: string;
  setlist: Setlist;
  selectedSongId?: string;
  updatedAt: string;
}

export function createProject(name: string, songs: Song[] = []): StudioProject {
  const id = crypto.randomUUID();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    name,
    setlist: { id: crypto.randomUUID(), name, songs },
    selectedSongId: songs[0]?.id,
    updatedAt: new Date().toISOString()
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
