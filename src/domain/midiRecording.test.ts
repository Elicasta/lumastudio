import { describe, expect, it } from "vitest";
import { goodness } from "./demo";
import { buildMidiClipFromRecording } from "./midiRecording";

describe("MIDI recording", () => {
  it("pairs note on/off messages and preserves performance timing", () => {
    const beatMicros = Math.round((60 / goodness.bpm) * 1_000_000);
    const clip = buildMidiClipFromRecording(goodness, "Piano Take", 0, [
      { timestampMicros: 0, bytes: [0x90, 60, 101] },
      { timestampMicros: Math.round(beatMicros / 2), bytes: [0xb0, 64, 127] },
      { timestampMicros: beatMicros, bytes: [0x80, 60, 0] }
    ]);

    const note = clip.events.find(event => event.type === "note");
    const sustain = clip.events.find(event => event.type === "cc");

    expect(note?.type).toBe("note");
    if (note?.type === "note") {
      expect(note.beat).toBeCloseTo(0, 3);
      expect(note.durationBeats).toBeCloseTo(1, 3);
      expect(note.velocity).toBe(101);
    }

    expect(sustain?.type).toBe("cc");
    if (sustain?.type === "cc") {
      expect(sustain.beat).toBeCloseTo(0.5, 3);
      expect(sustain.controller).toBe(64);
      expect(sustain.value).toBe(127);
    }
  });

  it("preserves program, pitch bend and pressure messages", () => {
    const clip = buildMidiClipFromRecording(goodness, "Expressive Take", 0, [
      { timestampMicros: 0, bytes: [0xc0, 12] },
      { timestampMicros: 10_000, bytes: [0xe0, 0x00, 0x40] },
      { timestampMicros: 20_000, bytes: [0xd0, 88] },
      { timestampMicros: 30_000, bytes: [0xa0, 64, 77] }
    ]);

    expect(clip.events.some(event => event.type === "program")).toBe(true);
    expect(clip.events.some(event => event.type === "pitch-bend")).toBe(true);
    expect(clip.events.some(event => event.type === "channel-pressure")).toBe(true);
    expect(clip.events.some(event => event.type === "poly-pressure")).toBe(true);
  });

  it("closes a held note at the end of the recorded take", () => {
    const beatMicros = Math.round((60 / goodness.bpm) * 1_000_000);
    const clip = buildMidiClipFromRecording(goodness, "Held", 0, [
      { timestampMicros: 0, bytes: [0x90, 60, 100] },
      { timestampMicros: beatMicros, bytes: [0xb0, 1, 50] }
    ]);

    const note = clip.events.find(event => event.type === "note");
    expect(note?.type).toBe("note");
    if (note?.type === "note") {
      expect(note.durationBeats).toBeCloseTo(1, 3);
    }
  });
});
