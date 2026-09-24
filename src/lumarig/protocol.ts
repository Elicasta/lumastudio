export const LUMARIG_BRIDGE_PROTOCOL = 1;

export type LumaRigTransport = "local" | "lan" | "relay";

export interface LumaRigPeer {
  id: string;
  name: string;
  transport: LumaRigTransport;
  endpoint?: string;
  latencyMs?: number;
}

export interface LumaRigSongIdentity {
  studioShowId: string;
  studioShowName: string;
  songId: string;
  songTitle: string;
  bpm: number;
}

export interface LumaRigRuntimeStatus {
  blackout: boolean;
  currentCueId: string | null;
  activeEffectId: string | null;
}

export function isLumaRigRuntimeStatus(value: unknown): value is LumaRigRuntimeStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Partial<LumaRigRuntimeStatus>;
  return typeof status.blackout === "boolean"
    && (status.currentCueId === null || typeof status.currentCueId === "string")
    && (status.activeEffectId === null || typeof status.activeEffectId === "string");
}

export type LumaRigCommand =
  | { type: "hello"; protocol: number; clientName: string }
  | { type: "status.get" }
  | ({ type: "song.resolve"; createIfMissing: boolean } & LumaRigSongIdentity)
  | { type: "show.load"; lumarigShowId: string }
  | { type: "cue.go"; cueId?: string }
  | { type: "scene.fire"; sceneId: string }
  | { type: "fx.start"; effectId: string }
  | { type: "fx.stop"; effectId: string }
  | { type: "record.start"; songId: string; songTitle: string; bpm: number }
  | { type: "record.stop" }
  | { type: "record.play"; recordingId: string; offsetMs?: number }
  | { type: "record.stopPlayback" }
  | { type: "blackout"; enabled: boolean }
  | { type: "transport"; playing: boolean; positionMs: number; bpm: number };

export interface LumaRigCommandEnvelope {
  id: string;
  command: LumaRigCommand;
}

export interface LumaRigCommandResult {
  id: string;
  ok: boolean;
  error?: string;
  payload?: unknown;
}

export function commandEnvelope(command: LumaRigCommand): LumaRigCommandEnvelope {
  return { id: crypto.randomUUID(), command };
}
