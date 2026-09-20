import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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

export async function choosePadAudio(): Promise<{ path: string; name: string } | null> {
  if (!isNativeApp()) throw new Error("Pad files can be selected in the LumaRig Studio desktop app.");
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Pad Audio", extensions: ["wav", "wave", "mp3", "aiff", "aif"] }]
  });
  if (!selected || Array.isArray(selected)) return null;
  const name = selected.split(/[\\/]/).pop()?.replace(/\.(wav|mp3|aiff?|wave)$/i, "") ?? "Pad";
  return { path: selected, name };
}

export async function loadNativePad(index: number, slot: PadSlot) {
  if (!slot.path) throw new Error("Load audio into this pad first.");
  await invoke("audio_load_pad", {
    index,
    path: slot.path,
    looped: slot.mode !== "one-shot",
    gainDb: slot.gainDb,
    width: slot.width / 100,
    octave: slot.octave,
    attackMs: slot.attackMs,
    releaseMs: slot.releaseMs
  });
}

export async function triggerNativePad(index: number) {
  await invoke("audio_trigger_pad", { index });
}

export async function releaseNativePad(index: number) {
  await invoke("audio_release_pad", { index });
}

export async function stopNativePad(index: number) {
  await invoke("audio_stop_pad", { index });
}

export async function configureNativePad(index: number, slot: PadSlot) {
  await invoke("audio_configure_pad", {
    index,
    gainDb: slot.gainDb,
    width: slot.width / 100,
    attackMs: slot.attackMs,
    releaseMs: slot.releaseMs
  });
}
