export interface MidiSettings {
  inputIndex?: number;
  inputName?: string;
  outputIndex?: number;
  outputName?: string;
  channel: number;
}

export function defaultMidiSettings(): MidiSettings {
  return { channel: 1 };
}
