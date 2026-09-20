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

export type CountInMode = "none" | "beats" | "bars" | "adaptive";
export type CountFeel = "notated" | "compound";
export type GuideOutputMode =
  | "off"
  | "click-only"
  | "voice-and-click"
  | "voice-only";
export type SectionCueMode = "off" | "automatic";

export interface GuideVoiceSettings {
  voicePackId: string;
  outputMode: GuideOutputMode;
  sectionCues: SectionCueMode;
  announceFirstSection: boolean;
  voiceFinalBarOnly: boolean;
  countFeel: CountFeel;
}

export interface CountInSettings {
  mode: CountInMode;
  value?: number;
  minBeats?: number;
}

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
  countInOverride?: CountInSettings;
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
  downbeatSeconds?: number;
  status: "ready" | "needs-review" | "processing";
  countIn: CountInSettings;
  manualJumpCountIn: CountInSettings;
  guideVoice: GuideVoiceSettings;
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
  | "songs"
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
