import { invoke } from "@tauri-apps/api/core";

export interface MidiPort {
  index: number;
  name: string;
}

export interface MidiDeviceSnapshot {
  inputs: MidiPort[];
  outputs: MidiPort[];
}

export interface MidiCapturedMessage {
  timestampMicros: number;
  bytes: number[];
}

export interface MidiRecordedMessage {
  timestampMicros: number;
  bytes: number[];
}

export const scanMidiDevices = () =>
  invoke<MidiDeviceSnapshot>("midi_scan");

export const listMidiInputs = () =>
  invoke<MidiPort[]>("midi_list_inputs");

export const listMidiOutputs = () =>
  invoke<MidiPort[]>("midi_list_outputs");

export const connectMidiInput = (index: number) =>
  invoke<string>("midi_connect_input", { index });

export const connectMidiOutput = (index: number) =>
  invoke<string>("midi_connect_output", { index });

export const disconnectMidiInput = () =>
  invoke<void>("midi_disconnect_input");

export const disconnectMidiOutput = () =>
  invoke<void>("midi_disconnect_output");

export const drainMidiInput = (maxMessages = 1024) =>
  invoke<MidiCapturedMessage[]>("midi_drain_input", { maxMessages });

export const startMidiRecording = () =>
  invoke<void>("midi_record_start");

export const stopMidiRecording = () =>
  invoke<MidiRecordedMessage[]>("midi_record_stop");

export const cancelMidiRecording = () =>
  invoke<void>("midi_record_cancel");

export const sendMidi = (bytes: number[]) =>
  invoke<void>("midi_send", { bytes });

export const sendProgramChange = (channel: number, program: number) =>
  invoke<void>("midi_program_change", { channel, program });

export const sendControlChange = (
  channel: number,
  controller: number,
  value: number
) =>
  invoke<void>("midi_control_change", { channel, controller, value });

export async function sendMidiPatch(patch: string) {
  const match = patch.trim().match(/^(?:pc:)?(\d+)(?:@(\d+))?$/i);
  if (!match) {
    throw new Error(
      "MIDI patch must be PROGRAM or PROGRAM@CHANNEL, for example 12@1."
    );
  }

  const program = Number(match[1]);
  const channel = Number(match[2] ?? 1);
  await sendProgramChange(channel, program);
}
