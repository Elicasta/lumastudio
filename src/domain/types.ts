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

export type TrackSourceType = "audio" | "midi" | "instrument" | "pad";
export type PluginFormat = "audio-unit" | "vst3";
export type PluginCategory = "instrument" | "effect";

export interface PluginReference {
  identifier: string;
  name: string;
  vendor?: string;
  format: PluginFormat;
  category: PluginCategory;
  componentType?: number;
  componentSubType?: number;
  componentManufacturer?: number;
  version?: string;
  hasCustomView?: boolean;
}

export interface PluginParameterValue {
  id: string;
  value: number;
}

export interface PluginInstance {
  id: string;
  plugin: PluginReference;
  bypassed: boolean;
  presetName?: string;
  state?: string;
  parameters?: PluginParameterValue[];
}

export interface TrackEffectSlot {
  id: string;
  enabled: boolean;
  plugin: PluginInstance;
}

export interface MidiPortTarget {
  outputName: string;
  channel: number;
}

export type InstrumentDestination =
  | {
      mode: "plugin";
      plugin: PluginInstance;
    }
  | {
      mode: "external-midi";
      target: MidiPortTarget;
    };

export interface MidiNoteEvent {
  id: string;
  type: "note";
  beat: number;
  durationBeats: number;
  note: number;
  velocity: number;
  channel: number;
}

export interface MidiControlChangeEvent {
  id: string;
  type: "cc";
  beat: number;
  controller: number;
  value: number;
  channel: number;
}

export interface MidiProgramChangeEvent {
  id: string;
  type: "program";
  beat: number;
  program: number;
  channel: number;
}

export interface MidiPitchBendEvent {
  id: string;
  type: "pitch-bend";
  beat: number;
  value: number;
  channel: number;
}

export interface MidiChannelPressureEvent {
  id: string;
  type: "channel-pressure";
  beat: number;
  value: number;
  channel: number;
}

export interface MidiPolyPressureEvent {
  id: string;
  type: "poly-pressure";
  beat: number;
  note: number;
  value: number;
  channel: number;
}

export type MidiEvent =
  | MidiNoteEvent
  | MidiControlChangeEvent
  | MidiProgramChangeEvent
  | MidiPitchBendEvent
  | MidiChannelPressureEvent
  | MidiPolyPressureEvent;

export interface MidiClip {
  id: string;
  name: string;
  startBeat: number;
  lengthBeats: number;
  events: MidiEvent[];
}

export interface PadSlotDefinition {
  id: string;
  name: string;
  path?: string;
  note: number;
  gainDb: number;
  mode: "one-shot" | "loop" | "hold" | "latch";
}

export interface PadInstrumentData {
  slots: PadSlotDefinition[];
}

export interface TrackGroup {
  id: string;
  name: string;
  color?: string;
  collapsed?: boolean;
}

export interface MidiTrigger {
  type: "note" | "cc";
  number: number;
  channel?: number;
  value?: number;
  inputName?: string;
}

export interface Locator {
  id: string;
  name: string;
  bar: number;
  beat: number;
  color?: string;
  midiTrigger?: MidiTrigger;
}

export interface LoopRegion {
  enabled: boolean;
  startBar: number;
  startBeat: number;
  endBar: number;
  endBeat: number;
}

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
  sourceType?: TrackSourceType;
  parentGroupId?: string;
  media?: {
    id: string;
    path: string;
    startSeconds: number;
  };
  midiInputName?: string;
  midiClips?: MidiClip[];
  instrument?: InstrumentDestination;
  padInstrument?: PadInstrumentData;
  effects?: TrackEffectSlot[];
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
  trackGroups?: TrackGroup[];
  locators?: Locator[];
  loopRegion?: LoopRegion;
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
