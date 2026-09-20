import { describe, expect, it } from "vitest";
import {
  cueIdsBeforePosition,
  duePresentationCues,
  effectiveCueTime
} from "./presentation";
import type { Song } from "./types";
import { goodness } from "./demo";

function songWithCues(): Song {
  return {
    ...goodness,
    bpm: 60,
    presentation: {
      mode: "full-auto",
      cueLeadBeats: 0.5,
      cues: [
        { id: "a", atSeconds: 10, action: "next" },
        { id: "b", atSeconds: 20, action: "next" }
      ]
    }
  };
}

describe("presentation automation", () => {
  it("converts lead beats into an earlier trigger time", () => {
    const song = songWithCues();
    expect(effectiveCueTime(song, song.presentation!.cues[0])).toBe(9.5);
  });

  it("returns only cues crossed by the current playback window", () => {
    const song = songWithCues();
    expect(duePresentationCues(song, 9.4, 9.6, new Set()).map((cue) => cue.id)).toEqual(["a"]);
    expect(duePresentationCues(song, 9.4, 9.6, new Set(["a"]))).toEqual([]);
  });

  it("marks past cues when playback seeks forward so they do not burst", () => {
    const song = songWithCues();
    expect([...cueIdsBeforePosition(song, 15)]).toEqual(["a"]);
  });
});
