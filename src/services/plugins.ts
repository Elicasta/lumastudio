import { invoke } from "@tauri-apps/api/core";
import type { NativeAudioStatus } from "./audio";

export interface AudioUnitPluginInfo {
  identifier: string;
  name: string;
  manufacturer: string;
  typeName: string;
  version: string;
  category: "instrument" | "effect" | "generator" | "midi-effect";
  componentType: number;
  componentSubType: number;
  componentManufacturer: number;
  hasCustomView: boolean;
  sandboxSafe: boolean;
}

export interface AudioUnitParameter {
  id: number;
  name: string;
  min: number;
  max: number;
  defaultValue: number;
  value: number;
  unit: number;
  flags: number;
}

export async function scanAudioUnits(): Promise<AudioUnitPluginInfo[]> {
  return invoke<AudioUnitPluginInfo[]>("audio_unit_scan");
}

export async function loadAudioUnitInstrument(
  plugin: AudioUnitPluginInfo,
  state?: string
): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_instrument_load", {
    plugin,
    state: state ?? null
  });
}

export async function unloadAudioUnitInstrument(): Promise<NativeAudioStatus> {
  return invoke<NativeAudioStatus>("audio_instrument_unload");
}

export async function getAudioUnitParameters(): Promise<AudioUnitParameter[]> {
  return invoke<AudioUnitParameter[]>("audio_instrument_parameters");
}

export async function setAudioUnitParameter(
  id: number,
  value: number
): Promise<void> {
  return invoke("audio_instrument_set_parameter", { id, value });
}

export async function saveAudioUnitState(): Promise<string> {
  return invoke<string>("audio_instrument_save_state");
}

export async function sendInstrumentMidi(bytes: number[]): Promise<void> {
  return invoke("audio_instrument_send_midi", { bytes });
}

export async function testInstrumentNote(
  note = 60,
  velocity = 100,
  channel = 1,
  durationMs = 350
): Promise<void> {
  const safeChannel = Math.max(1, Math.min(16, Math.round(channel))) - 1;
  const safeNote = Math.max(0, Math.min(127, Math.round(note)));
  const safeVelocity = Math.max(1, Math.min(127, Math.round(velocity)));

  await sendInstrumentMidi([0x90 | safeChannel, safeNote, safeVelocity]);
  window.setTimeout(() => {
    void sendInstrumentMidi([0x80 | safeChannel, safeNote, 0]);
  }, Math.max(20, durationMs));
}
