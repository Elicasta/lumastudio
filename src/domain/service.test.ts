import { describe, expect, it } from "vitest";
import { createServiceSong, selectedServiceSong } from "./service";

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
});
