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
export type PresentationMode = "manual" | "section-follow" | "full-auto";
export type PresentationCueAction = "next" | "previous";

export interface PresentationCue {
  id: string;
  atSeconds: number;
  action: PresentationCueAction;
}

export interface PresentationAutomation {
  mode: PresentationMode;
  cueLeadBeats: number;
  cues: PresentationCue[];
}

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

export interface GuideMarker {
  id: string;
  bar: number;
  beat: number;
  token: string;
  label?: string;
  gainDb?: number;
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

export interface SongExternalLinks {
  planningCenterSongId?: string;
  planningCenterArrangementId?: string;
  planningCenterPlanItemId?: string;
  planningCenterKeyId?: string;
  planningCenterSequence?: string[];
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
  guideMarkers: GuideMarker[];
  tracks: Track[];
  sections: Section[];
  external?: SongExternalLinks;
  presentation?: PresentationAutomation;
}

export interface Setlist {
  id: string;
  name: string;
  songs: Song[];
}

export type Workspace = "import" | "build" | "show" | "live";

export type BuildTool =
  | "arrangement"
  | "mixer"
  | "pads"
  | "lighting"
  | "presentation"
  | "midi"
  | "video";

export type ShowTool = "setlist" | "connections" | "integrations" | "settings";

export type Page =
  | Workspace
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
