import { invoke } from "@tauri-apps/api/core";

export interface MidiPort { index: number; name: string }

export const listMidiOutputs = () => invoke<MidiPort[]>("midi_list_outputs");
export const connectMidiOutput = (index: number) => invoke<string>("midi_connect_output", { index });
export const disconnectMidiOutput = () => invoke<void>("midi_disconnect_output");
export const sendMidi = (bytes: number[]) => invoke<void>("midi_send", { bytes });
export const sendProgramChange = (channel: number, program: number) => invoke<void>("midi_program_change", { channel, program });
export const sendControlChange = (channel: number, controller: number, value: number) => invoke<void>("midi_control_change", { channel, controller, value });

export async function sendMidiPatch(patch: string) {
  const match = patch.trim().match(/^(?:pc:)?(\d+)(?:@(\d+))?$/i);
  if (!match) throw new Error("MIDI patch must be PROGRAM or PROGRAM@CHANNEL, for example 12@1.");
  const program = Number(match[1]);
  const channel = Number(match[2] ?? 1);
  await sendProgramChange(channel, program);
}
