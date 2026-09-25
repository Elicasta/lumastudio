import { describe, expect, it } from "vitest";
import { goodness } from "./demo";
import { buildInstrumentTimeline } from "./instrumentTimeline";
import type { Track } from "./types";

function instrumentTrack(): Track {
  return {
    id: "keys",
    name: "Keys",
    kind: "midi",
    color: "#8b5cf6",
    enabled: true,
    muted: false,
    solo: false,
    gainDb: 0,
    sourceType: "instrument",
    midiClips: [
      {
        id: "take-1",
        name: "Take 1",
        startBeat: 0,
        lengthBeats: 4,
        events: [
          {
            id: "note",
            type: "note",
            beat: 0,
            durationBeats: 1,
            note: 60,
            velocity: 100,
            channel: 1
          },
          {
            id: "sustain",
            type: "cc",
            beat: 0.5,
            controller: 64,
            value: 127,
            channel: 1
          },
          {
            id: "bend",
            type: "pitch-bend",
            beat: 2,
            value: 8192,
            channel: 1
          }
        ]
      }
    ]
  };
}

describe("software instrument timeline", () => {
  it("expands notes into sample-schedulable note-on and note-off events", () => {
    const timeline = buildInstrumentTimeline(goodness, instrumentTrack());

    expect(timeline.events[0]).toEqual({
      atSeconds: 0,
      bytes: [0x90, 60, 100]
    });

    const noteOff = timeline.events.find(
      (event) => (event.bytes[0] & 0xf0) === 0x80
    );
    expect(noteOff?.atSeconds).toBeCloseTo(60 / goodness.bpm, 5);
  });

  it("preserves CC and 14-bit pitch bend encoding", () => {
    const timeline = buildInstrumentTimeline(goodness, instrumentTrack());

    expect(
      timeline.events.some(
        (event) =>
          event.bytes[0] === 0xb0 &&
          event.bytes[1] === 64 &&
          event.bytes[2] === 127
      )
    ).toBe(true);

    expect(
      timeline.events.some(
        (event) =>
          event.bytes[0] === 0xe0 &&
          event.bytes[1] === 0 &&
          event.bytes[2] === 64
      )
    ).toBe(true);
  });

  it("uses the arrangement length even when there are no audio stems", () => {
    const timeline = buildInstrumentTimeline(
      { ...goodness, durationSeconds: 0 },
      instrumentTrack()
    );

    expect(timeline.durationSeconds).toBeGreaterThan(0);
  });

  it("orders note-off before a retrigger at the same musical time", () => {
    const track = instrumentTrack();
    track.midiClips = [
      {
        id: "repeat",
        name: "Repeat",
        startBeat: 0,
        lengthBeats: 2,
        events: [
          {
            id: "one",
            type: "note",
            beat: 0,
            durationBeats: 1,
            note: 60,
            velocity: 100,
            channel: 1
          },
          {
            id: "two",
            type: "note",
            beat: 1,
            durationBeats: 1,
            note: 60,
            velocity: 100,
            channel: 1
          }
        ]
      }
    ];

    const timeline = buildInstrumentTimeline(goodness, track);
    const atBeatTwo = timeline.events.filter((event) =>
      Math.abs(event.atSeconds - 60 / goodness.bpm) < 0.00001
    );

    expect(atBeatTwo.map((event) => event.bytes[0] & 0xf0)).toEqual([
      0x80,
      0x90
    ]);
  });
});
