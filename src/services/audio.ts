import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { TrackKind } from "../domain/types";

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
  countInActive?: boolean;
  countInBeat?: number;
  countInTotal?: number;
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

export async function loadWavSong(
  tracks: NativeAudioTrack[]
): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_load_wav_song", {
    tracks: tracks.map(({ id, name, path, gainDb, startSeconds }) => ({
      id,
      name,
      path,
      gainDb,
      startSeconds
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
  keepAudio
}: {
  targetSeconds: number;
  delaySeconds: number;
  firstCountDelaySeconds: number;
  beatSeconds: number;
  countBeats: number;
  keepAudio: boolean;
}): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_schedule_transition", {
    targetSeconds,
    delaySeconds,
    firstCountDelaySeconds,
    beatSeconds,
    countBeats,
    keepAudio
  });
}

export async function audioCancelTransition(): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_cancel_transition");
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
