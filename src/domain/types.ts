export type TrackKind =
  | "click"
  | "guide"
  | "drums"
  | "bass"
  | "keys"
  | "guitar"
  | "vocals"
  | "other"
  | "midi"
  | "lighting"
  | "video";

export interface Section {
  id: string;
  name: string;
  startBar: number;
  lengthBars: number;
  color: string;
  tempoOverride?: number;
  meterOverride?: [number, number];
  lightingCue?: string;
  midiPatch?: string;
  videoCue?: string;
  followAction?: "next" | "stop" | "loop";
}

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  enabled: boolean;
  muted: boolean;
  solo: boolean;
  gainDb: number;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  key: string;
  meter: [number, number];
  durationSeconds: number;
  status: "ready" | "needs-review" | "processing";
  tracks: Track[];
  sections: Section[];
}

export interface Setlist {
  id: string;
  name: string;
  songs: Song[];
}

export type Page =
  | "setlist"
  | "arrangement"
  | "performance"
  | "pads"
  | "mixer"
  | "lighting"
  | "midi"
  | "video"
  | "sources"
  | "connections"
  | "settings";

export type ImportStep = "source" | "analyze" | "stems" | "sections" | "review";
