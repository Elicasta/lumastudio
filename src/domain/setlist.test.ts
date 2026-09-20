import { describe, expect, it } from "vitest";
import { demoSetlist } from "./demo";
import { adjacentSong } from "./setlist";

describe("adjacentSong", () => {
  it("returns the next song", () => {
    expect(adjacentSong(demoSetlist, "goodness", 1)?.id).toBe("graves");
  });

  it("returns the previous song", () => {
    expect(adjacentSong(demoSetlist, "goodness", -1)?.id).toBe("amazing");
  });

  it("does not wrap before the first song", () => {
    expect(adjacentSong(demoSetlist, "amazing", -1)).toBeNull();
  });

  it("does not wrap after the last song", () => {
    expect(adjacentSong(demoSetlist, "living", 1)).toBeNull();
  });

  it("returns null when the song is not in the setlist", () => {
    expect(adjacentSong(demoSetlist, "imported-local-song", 1)).toBeNull();
  });
});
