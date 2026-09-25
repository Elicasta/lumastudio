import { musicalBeatToSeconds, songEndSeconds } from "./timing";
import type { MidiEvent, Song, Track } from "./types";

export interface InstrumentTimelineEvent {
  atSeconds: number;
  bytes: number[];
}

export interface InstrumentTimeline {
  durationSeconds: number;
  events: InstrumentTimelineEvent[];
}

export function buildInstrumentTimeline(song: Song, track: Track): InstrumentTimeline {
  const events: InstrumentTimelineEvent[] = [];

  for (const clip of track.midiClips ?? []) {
    for (const event of clip.events) {
      const absoluteBeat = clip.startBeat + Math.max(0, event.beat);
      const atSeconds = musicalBeatToSeconds(song, absoluteBeat);

      if (event.type === "note") {
        events.push({
          atSeconds,
          bytes: statusBytes(0x90, event.channel, event.note, event.velocity)
        });
        events.push({
          atSeconds: musicalBeatToSeconds(
            song,
            absoluteBeat + Math.max(1 / 960, event.durationBeats)
          ),
          bytes: statusBytes(0x80, event.channel, event.note, 0)
        });
        continue;
      }

      if (event.type === "cc") {
        events.push({
          atSeconds,
          bytes: statusBytes(0xb0, event.channel, event.controller, event.value)
        });
        continue;
      }

      if (event.type === "program") {
        events.push({
          atSeconds,
          bytes: [
            0xc0 | channelNibble(event.channel),
            clamp7(event.program)
          ]
        });
        continue;
      }

      if (event.type === "pitch-bend") {
        const value = Math.max(0, Math.min(16383, Math.round(event.value)));
        events.push({
          atSeconds,
          bytes: [
            0xe0 | channelNibble(event.channel),
            value & 0x7f,
            (value >> 7) & 0x7f
          ]
        });
        continue;
      }

      if (event.type === "channel-pressure") {
        events.push({
          atSeconds,
          bytes: [
            0xd0 | channelNibble(event.channel),
            clamp7(event.value)
          ]
        });
        continue;
      }

      if (event.type === "poly-pressure") {
        events.push({
          atSeconds,
          bytes: statusBytes(
            0xa0,
            event.channel,
            event.note,
            event.value
          )
        });
      }
    }
  }

  events.sort(compareTimelineEvents);

  return {
    durationSeconds: songEndSeconds(song),
    events
  };
}

function compareTimelineEvents(
  a: InstrumentTimelineEvent,
  b: InstrumentTimelineEvent
) {
  if (a.atSeconds !== b.atSeconds) return a.atSeconds - b.atSeconds;

  const aFamily = (a.bytes[0] ?? 0) & 0xf0;
  const bFamily = (b.bytes[0] ?? 0) & 0xf0;
  const aOff = aFamily === 0x80 || (aFamily === 0x90 && (a.bytes[2] ?? 0) === 0);
  const bOff = bFamily === 0x80 || (bFamily === 0x90 && (b.bytes[2] ?? 0) === 0);

  if (aOff !== bOff) return aOff ? -1 : 1;
  return 0;
}

function channelNibble(channel: number) {
  return Math.max(1, Math.min(16, Math.round(channel))) - 1;
}

function clamp7(value: number) {
  return Math.max(0, Math.min(127, Math.round(value)));
}

function statusBytes(
  family: number,
  channel: number,
  data1: number,
  data2: number
) {
  return [
    family | channelNibble(channel),
    clamp7(data1),
    clamp7(data2)
  ];
}
