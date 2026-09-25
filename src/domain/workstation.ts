import { barBeatToSeconds } from "./timing";
import type {
  InstrumentDestination,
  Locator,
  LoopRegion,
  MidiTrigger,
  PadInstrumentData,
  Song,
  Track,
  TrackEffectSlot,
  TrackGroup
} from "./types";

function id() {
  return crypto.randomUUID();
}

function baseTrack(name: string, kind: Track["kind"], color: string): Track {
  return {
    id: id(),
    name,
    kind,
    color,
    enabled: true,
    muted: false,
    solo: false,
    gainDb: 0
  };
}

export function createMidiTrack(
  name = "MIDI",
  destination?: InstrumentDestination
): Track {
  return {
    ...baseTrack(name, "midi", "#8b5cf6"),
    sourceType: destination?.mode === "plugin" ? "instrument" : "midi",
    instrument: destination,
    midiClips: [],
    effects: []
  };
}

export function createSoftwareInstrumentTrack(name = "Software Instrument"): Track {
  return {
    ...baseTrack(name, "midi", "#8b5cf6"),
    sourceType: "instrument",
    midiClips: [],
    effects: []
  };
}

export function createPadInstrumentTrack(name = "Pads"): Track {
  const padInstrument: PadInstrumentData = { slots: [] };
  return {
    ...baseTrack(name, "other", "#14b8a6"),
    sourceType: "pad",
    padInstrument,
    effects: []
  };
}

export function createTrackGroup(name: string): TrackGroup {
  return {
    id: id(),
    name,
    collapsed: false
  };
}

export function addTrackEffect(track: Track, effect: TrackEffectSlot): Track {
  return {
    ...track,
    effects: [...(track.effects ?? []), effect]
  };
}

export function sortedLocators(song: Song): Locator[] {
  return [...(song.locators ?? [])].sort((a, b) =>
    a.bar === b.bar ? a.beat - b.beat : a.bar - b.bar
  );
}

export function loopRegionSeconds(
  song: Song,
  region: LoopRegion | undefined = song.loopRegion
): { startSeconds: number; endSeconds: number } | null {
  if (!region?.enabled) return null;

  const startSeconds = barBeatToSeconds(
    song,
    region.startBar,
    region.startBeat
  );
  const endSeconds = barBeatToSeconds(song, region.endBar, region.endBeat);

  if (endSeconds <= startSeconds) return null;
  return { startSeconds, endSeconds };
}

export function locatorSeconds(song: Song, locator: Locator): number {
  return barBeatToSeconds(song, locator.bar, locator.beat);
}

export function midiMessageMatchesTrigger(
  bytes: number[],
  trigger: MidiTrigger
): boolean {
  if (bytes.length < 2) return false;

  const status = bytes[0] ?? 0;
  const channel = (status & 0x0f) + 1;
  if (trigger.channel && channel !== trigger.channel) return false;

  const family = status & 0xf0;

  if (trigger.type === "note") {
    if (family !== 0x90 || (bytes[2] ?? 0) === 0) return false;
    return bytes[1] === trigger.number;
  }

  if (family !== 0xb0 || bytes[1] !== trigger.number) return false;
  return trigger.value === undefined || bytes[2] === trigger.value;
}
