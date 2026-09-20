import { describe, expect, it } from "vitest";
import { demoSetlist, goodness } from "../domain/demo";
import { buildRemoteStudioState } from "./state";

describe("buildRemoteStudioState", () => {
  it("keeps Studio Setlist and Song as the remote source of truth", () => {
    const state = buildRemoteStudioState({
      setlist: demoSetlist,
      song: goodness,
      currentSectionIndex: 4,
      previewPlaying: false,
      audioStatus: {
        initialized: true,
        playing: true,
        positionSeconds: 120,
        durationSeconds: 318,
        loadedTracks: 6,
        peakLeft: 0.7,
        peakRight: 0.6
      }
    });

    expect(state.protocolVersion).toBe(2);
    expect(state.setlist.id).toBe(demoSetlist.id);
    expect(state.setlist.songs).toHaveLength(demoSetlist.songs.length);
    expect(state.song.id).toBe(goodness.id);
    expect(state.sections[state.currentSectionIndex].id).toBe("chorus2");
    expect(state.queuedSectionIndex).toBe(5);
    expect(state.transport.playing).toBe(true);
  });

  it("does not claim MIDI or lighting are live before those runtimes exist", () => {
    const state = buildRemoteStudioState({
      setlist: demoSetlist,
      song: goodness,
      currentSectionIndex: 0,
      previewPlaying: false,
      audioStatus: { initialized: false }
    });

    expect(state.health.midi).toBe(false);
    expect(state.health.lighting).toBe(false);
  });
});
