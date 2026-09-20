import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isNativeApp } from "./audio";

export type PadMode = "one-shot" | "loop" | "hold" | "latch";

export interface PadSlot {
  id: string;
  name: string;
  path?: string;
  mode: PadMode;
  gainDb: number;
  octave: number;
  width: number;
  attackMs: number;
  releaseMs: number;
}

type PlayingPad = {
  audio: HTMLAudioElement;
  latched: boolean;
};

const playing = new Map<string, PlayingPad>();

export async function choosePadAudio(): Promise<{ path: string; name: string } | null> {
  if (!isNativeApp()) throw new Error("Pad files can be selected in the LumaRig Studio desktop app.");
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Pad Audio", extensions: ["wav", "mp3", "aiff", "aif"] }]
  });
  if (!selected || Array.isArray(selected)) return null;
  const name = selected.split(/[\\/]/).pop()?.replace(/\.(wav|mp3|aiff?|wave)$/i, "") ?? "Pad";
  return { path: selected, name };
}

function fileUrl(path: string) {
  return convertFileSrc(path);
}

export function triggerPad(slot: PadSlot) {
  if (!slot.path) throw new Error("Load audio into this pad first.");
  const current = playing.get(slot.id);
  if (slot.mode === "latch" && current) {
    current.audio.pause();
    current.audio.currentTime = 0;
    playing.delete(slot.id);
    return false;
  }
  if (current) {
    current.audio.pause();
    playing.delete(slot.id);
  }
  const audio = new Audio(fileUrl(slot.path));
  audio.loop = slot.mode === "loop" || slot.mode === "hold" || slot.mode === "latch";
  audio.volume = Math.max(0, Math.min(1, Math.pow(10, slot.gainDb / 20)));
  audio.playbackRate = Math.pow(2, slot.octave);
  audio.onended = () => playing.delete(slot.id);
  playing.set(slot.id, { audio, latched: slot.mode === "latch" });
  void audio.play();
  return true;
}

export function releasePad(slot: PadSlot) {
  if (slot.mode !== "hold") return;
  const current = playing.get(slot.id);
  if (!current) return;
  current.audio.pause();
  current.audio.currentTime = 0;
  playing.delete(slot.id);
}

export function stopAllPads() {
  for (const current of playing.values()) {
    current.audio.pause();
    current.audio.currentTime = 0;
  }
  playing.clear();
}

export function isPadPlaying(id: string) {
  return playing.has(id);
}
