import { describe, expect, it } from "vitest";
import { closeSections, snapBar, uniqueSectionLabel } from "./sections";

describe("section helpers", () => {
  it("closes each section at the next marker", () => {
    const sections = closeSections([
      { id: "a", name: "Intro", startBar: 1, color: "#38bdf8" },
      { id: "b", name: "Verse", startBar: 9, color: "#60a5fa" },
      { id: "c", name: "Chorus", startBar: 25, color: "#fb7185" }
    ], 40);

    expect(sections.map((section) => section.lengthBars)).toEqual([8, 16, 16]);
  });

  it("snaps a beat index to a one-based bar", () => {
    expect(snapBar(0, 4)).toBe(1);
    expect(snapBar(31.9, 4)).toBe(8);
    expect(snapBar(32, 4)).toBe(9);
  });

  it("numbers repeated labels", () => {
    const sections = [
      { id: "a", name: "Chorus", startBar: 1, lengthBars: 8, color: "#fff" }
    ];
    expect(uniqueSectionLabel("Chorus", sections)).toBe("Chorus 2");
  });
});
