export type VideoOutputKind = "display" | "ndi";
export type ShowControlProviderKind = "lumarig" | "artnet" | "sacn" | "osc" | "midi";

export interface VideoOutput {
  id: string;
  name: string;
  kind: VideoOutputKind;
  enabled: boolean;
}

export interface LumaRigConnection {
  host: string;
  port: number;
  connected: boolean;
  armed: boolean;
  lastHeartbeatAt?: string;
}

export interface SectionOutputCue {
  sectionId: string;
  videoCue?: string;
  lightingCue?: string;
  midiPatch?: string;
}
