import { describe, expect, it } from "vitest";
import { createServiceSong, moveServiceItem, reflowSongSections, selectedServiceSong } from "./service";

describe("service creation", () => {
  it("creates independent items without fabricated audio or cue assignments", () => {
    const first = createServiceSong(" Opening ");
    const second = createServiceSong("Prayer");
    expect(first.title).toBe("Opening");
    expect(first.id).not.toBe(second.id);
    expect(first.tracks).toEqual([]);
    expect(first.sections[0].lightingCue).toBeUndefined();
    expect(first.status).toBe("needs-review");
    expect(first.guideVoice.outputMode).toBe("off");
  });
  it("returns no selected item for an empty service", () => {
    expect(selectedServiceSong([], "missing")).toBeUndefined();
    expect(() => createServiceSong("   ")).toThrow("Enter a title");
  });
  it("moves later sections and guide cues together when bars change", () => {
    const song = createServiceSong("Song");
    const first = song.sections[0];
    const second = { ...first, id: crypto.randomUUID(), name: "Verse", startBar: 9 };
    song.sections.push(second);
    song.guideMarkers = [{ id: "cue", bar: 10, beat: 1, token: "direction.build" }];
    const edited = reflowSongSections(song, [{ ...first, lengthBars: 12 }, second]);
    expect(edited.sections[1].startBar).toBe(13);
    expect(edited.guideMarkers[0].bar).toBe(14);
    expect(() => reflowSongSections(song, [first, first])).toThrow("unique");
  });
  it("reorders a running order while retaining the same item identities", () => {
    const first = createServiceSong("Opening"), second = createServiceSong("Song");
    expect(moveServiceItem([first,second], first.id, 1)).toEqual([second,first]);
    expect(moveServiceItem([first,second], first.id, -1)).toEqual([first,second]);
  });
});
