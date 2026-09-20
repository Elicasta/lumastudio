import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { TrackKind } from "../domain/types";

export interface NativeAudioBusStatus {
  gainDb: number;
  muted: boolean;
  outputLeft: number;
  outputRight: number;
}

export interface NativeVoicePackInfo {
  id: string;
  name: string;
  locale: string;
  voice: string;
  version: number;
  assetCount: number;
}

export interface NativeGuideTimelineEvent {
  atSeconds: number;
  token: string;
  gainDb?: number;
}

export interface NativeGuideTransitionEvent {
  offsetPulses: number;
  token: string;
  gainDb?: number;
}

export interface NativeAudioStatus {
  initialized: boolean;
  deviceName?: string;
  sampleRate?: number;
  outputChannels?: number;
  playing?: boolean;
  positionSeconds?: number;
  durationSeconds?: number;
  peakLeft?: number;
  peakRight?: number;
  deviceError?: boolean;
  loadedTracks?: number;
  transitionActive?: boolean;
  countInActive?: boolean;
  countInBeat?: number;
  countInTotal?: number;
  countInBar?: number;
  countInBars?: number;
  voicePack?: NativeVoicePackInfo | null;
  musicBus?: NativeAudioBusStatus;
  clickBus?: NativeAudioBusStatus;
  guideBus?: NativeAudioBusStatus;
  masterBus?: NativeAudioBusStatus;
  lastError?: string | null;
}

export interface NativeAudioTrack {
  id: string;
  name: string;
  path: string;
  gainDb: number;
  startSeconds: number;
  kind: TrackKind;
  color: string;
}

const colors: Record<TrackKind, string> = {
  click: "#cbd5e1",
  guide: "#60a5fa",
  drums: "#22d3ee",
  bass: "#34d399",
  keys: "#facc15",
  guitar: "#fb923c",
  vocals: "#f472b6",
  other: "#a78bfa",
  midi: "#8b5cf6",
  lighting: "#f59e0b",
  video: "#38bdf8"
};

export function isNativeApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getAudioStatus(): Promise<NativeAudioStatus> {
  if (!isNativeApp()) {
    return { initialized: false, lastError: "Native audio is available in the Tauri app." };
  }
  return invoke<NativeAudioStatus>("audio_status");
}

export async function chooseWavTracks(): Promise<NativeAudioTrack[]> {
  if (!isNativeApp()) {
    throw new Error("Open LumaRig Studio as the desktop app to select local audio files.");
  }

  const selected = await open({
    multiple: true,
    directory: false,
    filters: [{ name: "WAV Audio", extensions: ["wav", "wave"] }]
  });

  if (!selected) return [];

  const paths = Array.isArray(selected) ? selected : [selected];

  return paths.map((path, index) => {
    const filename = path.split(/[\\/]/).pop() ?? "Track " + (index + 1);
    const name = filename.replace(/\.(wav|wave)$/i, "");
    const kind = inferTrackKind(name);

    return {
      id: uniqueTrackId(name, index),
      name,
      path,
      gainDb: 0,
      startSeconds: 0,
      kind,
      color: colors[kind]
    };
  });
}

export async function chooseVoicePackDirectory(): Promise<string | null> {
  if (!isNativeApp()) {
    throw new Error("Voice packs can be loaded from the LumaRig Studio desktop app.");
  }

  const selected = await open({
    multiple: false,
    directory: true
  });

  if (!selected || Array.isArray(selected)) return null;
  return selected;
}

export async function loadVoicePack(
  directory: string
): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_load_voice_pack", { directory });
}

export async function setGuideTimeline(
  events: NativeGuideTimelineEvent[]
): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_set_guide_timeline", { events });
}

export async function loadWavSong(
  tracks: NativeAudioTrack[]
): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_load_wav_song", {
    tracks: tracks.map(({ id, name, path, gainDb, startSeconds, kind }) => ({
      id,
      name,
      path,
      gainDb,
      startSeconds,
      bus: kind === "click" ? "click" : kind === "guide" ? "guide" : "music"
    }))
  });
}

export async function audioPlay(): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_play");
}

export async function audioPause(): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_pause");
}

export async function audioStop(): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_stop");
}

export async function audioSeek(seconds: number): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_seek", { seconds });
}
export async function audioScheduleTransition({
  targetSeconds,
  delaySeconds,
  firstCountDelaySeconds,
  beatSeconds,
  countBeats,
  pulsesPerBar,
  clickEnabled,
  keepAudio,
  guideEvents = []
}: {
  targetSeconds: number;
  delaySeconds: number;
  firstCountDelaySeconds: number;
  beatSeconds: number;
  countBeats: number;
  pulsesPerBar: number;
  clickEnabled: boolean;
  keepAudio: boolean;
  guideEvents?: NativeGuideTransitionEvent[];
}): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_schedule_transition", {
    targetSeconds,
    delaySeconds,
    firstCountDelaySeconds,
    beatSeconds,
    countBeats,
    pulsesPerBar,
    clickEnabled,
    keepAudio,
    guideEvents
  });
}

export async function audioCancelTransition(): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_cancel_transition");
}


export async function setNativeBusGain(
  id: "music" | "click" | "guide" | "master",
  gainDb: number
): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_set_bus_gain", { id, gainDb });
}

export async function setNativeBusMuted(
  id: "music" | "click" | "guide" | "master",
  muted: boolean
): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_set_bus_muted", { id, muted });
}

export async function setNativeBusRoute(
  id: "music" | "click" | "guide",
  outputLeft: number,
  outputRight: number
): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_set_bus_route", {
    id,
    outputLeft,
    outputRight
  });
}

export async function setNativeTrackGain(id: string, gainDb: number): Promise<void> {
  await invoke("audio_set_track_gain", { id, gainDb });
}

export async function setNativeTrackMuted(id: string, muted: boolean): Promise<void> {
  await invoke("audio_set_track_muted", { id, muted });
}

export async function setNativeTrackSolo(id: string, solo: boolean): Promise<void> {
  await invoke("audio_set_track_solo", { id, solo });
}

export async function setNativeLoop(
  startSeconds: number,
  endSeconds: number
): Promise<void> {
  await invoke("audio_set_loop", { startSeconds, endSeconds });
}

export async function clearNativeLoop(): Promise<void> {
  await invoke("audio_clear_loop");
}

export function inferTrackKind(name: string): TrackKind {
  const normalized = name.toLowerCase();

  if (/\bclick\b|metronome/.test(normalized)) return "click";
  if (/\bguide\b|cue/.test(normalized)) return "guide";
  if (/drum|kick|snare|perc/.test(normalized)) return "drums";
  if (/bass/.test(normalized)) return "bass";
  if (/keys|piano|organ|synth/.test(normalized)) return "keys";
  if (/guitar|gtr|acoustic|electric/.test(normalized)) return "guitar";
  if (/vocal|vox|bgv|choir/.test(normalized)) return "vocals";

  return "other";
}

function uniqueTrackId(name: string, index: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);

  return (slug || "track") + "-" + (index + 1);
}
