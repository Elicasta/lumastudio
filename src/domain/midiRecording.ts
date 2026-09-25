import { musicalBeatAtSeconds } from "./timing";
import type {
  MidiClip,
  MidiEvent,
  MidiNoteEvent,
  Song
} from "./types";

export interface RecordedMidiMessage {
  timestampMicros: number;
  bytes: number[];
}

interface PendingNote {
  beat: number;
  velocity: number;
  channel: number;
  note: number;
}

function eventId() {
  return crypto.randomUUID();
}

export function buildMidiClipFromRecording(
  song: Song,
  name: string,
  recordingStartSeconds: number,
  messages: RecordedMidiMessage[]
): MidiClip {
  const startBeat = musicalBeatAtSeconds(song, recordingStartSeconds);
  const events: MidiEvent[] = [];
  const pending = new Map<string, PendingNote[]>();

  let takeEndBeat = startBeat;

  for (const message of messages) {
    if (!message.bytes.length) continue;

    const status = message.bytes[0] ?? 0;
    const family = status & 0xf0;
    if (!(0x80 <= family && family <= 0xe0)) continue;

    const channel = (status & 0x0f) + 1;
    const data1 = message.bytes[1] ?? 0;
    const data2 = message.bytes[2] ?? 0;
    const absoluteSeconds =
      recordingStartSeconds + Math.max(0, message.timestampMicros) / 1_000_000;
    const absoluteBeat = musicalBeatAtSeconds(song, absoluteSeconds);
    const beat = Math.max(0, absoluteBeat - startBeat);
    takeEndBeat = Math.max(takeEndBeat, absoluteBeat);

    if (family === 0x90 && data2 > 0) {
      const key = channel + ":" + data1;
      const queue = pending.get(key) ?? [];
      queue.push({
        beat,
        velocity: data2,
        channel,
        note: data1
      });
      pending.set(key, queue);
      continue;
    }

    if (family === 0x80 || (family === 0x90 && data2 === 0)) {
      const key = channel + ":" + data1;
      const queue = pending.get(key);
      const noteOn = queue?.shift();
      if (!noteOn) continue;
      if (queue?.length === 0) pending.delete(key);

      const note: MidiNoteEvent = {
        id: eventId(),
        type: "note",
        beat: noteOn.beat,
        durationBeats: Math.max(1 / 960, beat - noteOn.beat),
        note: noteOn.note,
        velocity: noteOn.velocity,
        channel: noteOn.channel
      };
      events.push(note);
      continue;
    }

    if (family === 0xb0) {
      events.push({
        id: eventId(),
        type: "cc",
        beat,
        controller: data1,
        value: data2,
        channel
      });
      continue;
    }

    if (family === 0xc0) {
      events.push({
        id: eventId(),
        type: "program",
        beat,
        program: data1,
        channel
      });
      continue;
    }

    if (family === 0xe0) {
      events.push({
        id: eventId(),
        type: "pitch-bend",
        beat,
        value: ((data2 & 0x7f) << 7) | (data1 & 0x7f),
        channel
      });
      continue;
    }

    if (family === 0xd0) {
      events.push({
        id: eventId(),
        type: "channel-pressure",
        beat,
        value: data1,
        channel
      });
      continue;
    }

    if (family === 0xa0) {
      events.push({
        id: eventId(),
        type: "poly-pressure",
        beat,
        note: data1,
        value: data2,
        channel
      });
    }
  }

  const takeLength = Math.max(1 / 16, takeEndBeat - startBeat);

  for (const queue of pending.values()) {
    for (const noteOn of queue) {
      events.push({
        id: eventId(),
        type: "note",
        beat: noteOn.beat,
        durationBeats: Math.max(1 / 960, takeLength - noteOn.beat),
        note: noteOn.note,
        velocity: noteOn.velocity,
        channel: noteOn.channel
      });
    }
  }

  events.sort((a, b) => {
    if (a.beat !== b.beat) return a.beat - b.beat;
    if (a.type === "note" && b.type !== "note") return -1;
    if (a.type !== "note" && b.type === "note") return 1;
    return 0;
  });

  const contentEnd = events.reduce((end, event) => {
    const eventEnd =
      event.type === "note"
        ? event.beat + event.durationBeats
        : event.beat;
    return Math.max(end, eventEnd);
  }, 0);

  return {
    id: crypto.randomUUID(),
    name: name.trim() || "MIDI Take",
    startBeat,
    lengthBeats: Math.max(takeLength, contentEnd, 1 / 16),
    events
  };
}
