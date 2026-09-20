export interface MidiSettings {
  outputIndex?: number;
  outputName?: string;
  channel: number;
}

export function defaultMidiSettings(): MidiSettings {
  return { channel: 1 };
}
