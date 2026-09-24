import { parseProject, type StudioProject } from "../domain/project";

const KEY = "lumastudio.recovery.v1";
const MAX_SNAPSHOT_LENGTH = 2_000_000;

export interface RecoverySnapshot { project: StudioProject; savedAt: string }

export function readRecovery(storage: Pick<Storage, "getItem">): RecoverySnapshot | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw || raw.length > MAX_SNAPSHOT_LENGTH) return null;
    const value = JSON.parse(raw) as Partial<RecoverySnapshot>;
    if (typeof value.savedAt !== "string" || !value.project) return null;
    if (!Number.isFinite(Date.parse(value.savedAt))) return null;
    const project = parseProject(JSON.stringify(value.project));
    if (!project.setlist.songs.length && project.name === "New Service") return null;
    return { savedAt: value.savedAt, project };
  } catch { return null; }
}

export function writeRecovery(storage: Pick<Storage, "setItem">, project: StudioProject, savedAt = new Date().toISOString()): void {
  const raw = JSON.stringify({ savedAt, project });
  if (raw.length > MAX_SNAPSHOT_LENGTH) throw new Error("The service exceeds the local recovery size limit. Save it to a project file.");
  storage.setItem(KEY, raw);
}

export function clearRecovery(storage: Pick<Storage, "removeItem">): void { storage.removeItem(KEY); }
