export const REMOTE_PROTOCOL_VERSION = 2 as const;

export const REMOTE_COMMANDS = [
  "transport.play",
  "transport.pause",
  "transport.stop",
  "transport.go",
  "transport.previous",
  "transport.next",
  "section.launch",
  "song.next",
  "song.previous",
  "song.select",
  "pad.trigger",
  "pad.release",
  "mixer.gain",
  "mixer.mute",
  "mixer.solo",
  "lighting.blackout",
  "lighting.scene",
  "lighting.xy"
] as const;

export type RemoteCommand = (typeof REMOTE_COMMANDS)[number];

export function isRemoteCommand(value: unknown): value is RemoteCommand {
  return REMOTE_COMMANDS.includes(value as RemoteCommand);
}

export interface RemoteCommandEnvelope {
  type: "command";
  id: string;
  command: RemoteCommand;
  payload?: Record<string, unknown>;
}

export interface RemoteSectionState {
  id: string;
  name: string;
  startBar: number;
  lengthBars: number;
}

export interface RemoteCountInSettings {
  mode: "none" | "beats" | "bars" | "adaptive";
  value?: number;
  minBeats?: number;
}

export interface RemoteSetlistSongState {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  key: string;
  meter: [number, number];
  durationSeconds: number;
  status: "ready" | "needs-review" | "processing";
  countIn: RemoteCountInSettings;
  current: boolean;
}

export interface RemoteStudioState {
  protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
  revision: number;
  setlist: {
    id: string;
    name: string;
    songs: RemoteSetlistSongState[];
  };
  song: {
    id: string;
    title: string;
    artist: string;
    bpm: number;
    key: string;
    meter: [number, number];
  };
  sections: RemoteSectionState[];
  currentSectionIndex: number;
  queuedSectionIndex: number | null;
  transport: {
    playing: boolean;
    positionSeconds: number;
    durationSeconds: number;
    bar: number;
    beat: number;
    countInActive: boolean;
    countInBeat: number;
    countInTotal: number;
    queuedSectionId: string | null;
  };
  pads: Array<{
    id: string;
    name: string;
    active: boolean;
    color: string;
  }>;
  mixer: Array<{
    id: string;
    name: string;
    gainDb: number;
    muted: boolean;
    solo: boolean;
    meter: number;
    color: string;
  }>;
  lighting: {
    blackout: boolean;
    scenes: Array<{
      id: string;
      name: string;
      color: string;
      active: boolean;
    }>;
    x: number;
    y: number;
  };
  health: {
    audio: boolean;
    midi: boolean;
    lighting: boolean;
    remote: boolean;
  };
}

export interface RemoteCommandAck {
  id: string;
  ok: boolean;
  error?: string;
}

export function isRemoteCommandEnvelope(value: unknown): value is RemoteCommandEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RemoteCommandEnvelope>;
  return (
    candidate.type === "command" &&
    typeof candidate.id === "string" &&
    isRemoteCommand(candidate.command)
  );
}
