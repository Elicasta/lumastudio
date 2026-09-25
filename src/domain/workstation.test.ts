import { describe, expect, it } from "vitest";
import { goodness } from "./demo";
import {
  loopRegionSeconds,
  midiMessageMatchesTrigger,
  sortedLocators
} from "./workstation";

describe("workstation helpers", () => {
  it("sorts locators by musical position", () => {
    const song = {
      ...goodness,
      locators: [
        { id: "chorus", name: "Chorus", bar: 17, beat: 1 },
        { id: "verse", name: "Verse", bar: 9, beat: 1 },
        { id: "pickup", name: "Pickup", bar: 9, beat: 4 }
      ]
    };

    expect(sortedLocators(song).map(locator => locator.id)).toEqual([
      "verse",
      "pickup",
      "chorus"
    ]);
  });

  it("turns a musical loop region into transport seconds", () => {
    const result = loopRegionSeconds({
      ...goodness,
      loopRegion: {
        enabled: true,
        startBar: 9,
        startBeat: 1,
        endBar: 17,
        endBeat: 1
      }
    });

    expect(result).not.toBeNull();
    expect(result!.endSeconds).toBeGreaterThan(result!.startSeconds);
  });

  it("matches note triggers by note and optional channel", () => {
    expect(
      midiMessageMatchesTrigger(
        [0x91, 60, 100],
        { type: "note", number: 60, channel: 2 }
      )
    ).toBe(true);

    expect(
      midiMessageMatchesTrigger(
        [0x90, 60, 100],
        { type: "note", number: 60, channel: 2 }
      )
    ).toBe(false);
  });

  it("does not treat note-off-by-zero-velocity as a locator trigger", () => {
    expect(
      midiMessageMatchesTrigger(
        [0x90, 60, 0],
        { type: "note", number: 60 }
      )
    ).toBe(false);
  });

  it("matches CC triggers and optional exact values", () => {
    expect(
      midiMessageMatchesTrigger(
        [0xb0, 20, 127],
        { type: "cc", number: 20, value: 127 }
      )
    ).toBe(true);

    expect(
      midiMessageMatchesTrigger(
        [0xb0, 20, 64],
        { type: "cc", number: 20, value: 127 }
      )
    ).toBe(false);
  });
});
