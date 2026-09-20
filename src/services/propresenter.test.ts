import { describe, expect, it } from "vitest";
import {
  findMatchingProPresenterGroup,
  parseProPresenterSnapshot
} from "./propresenter";

describe("ProPresenter integration", () => {
  it("derives the current group from the active slide index", () => {
    const state = parseProPresenterSnapshot({
      version: { version: "21.4" },
      active: {
        presentation: {
          id: { uuid: "holy-1", name: "Holy Forever" },
          groups: [
            { name: "Verse 1", slides: [{ enabled: true }, { enabled: true }] },
            { name: "Chorus", slides: [{ enabled: true }, { enabled: true }, { enabled: true }] },
            { name: "Bridge", slides: [{ enabled: true }, { enabled: true }] }
          ]
        }
      },
      slideIndex: { presentation_index: { index: 3, presentation_id: "holy-1" } },
      statusSlide: {
        current: { text: "Your name is the highest" },
        next: { text: "Your name is the greatest" }
      }
    });

    expect(state.connected).toBe(true);
    expect(state.presentationName).toBe("Holy Forever");
    expect(state.currentGroup).toBe("Chorus");
    expect(state.currentSlideInGroup).toBe(2);
    expect(state.currentGroupSlides).toBe(3);
    expect(state.currentText).toContain("highest");
  });

  it("matches numbered Studio sections to an unnumbered ProPresenter group", () => {
    const groups = [
      { name: "Verse", index: 0, startIndex: 0, slideCount: 2 },
      { name: "Chorus", index: 1, startIndex: 2, slideCount: 2 }
    ];

    expect(findMatchingProPresenterGroup("Chorus 2", groups)?.name).toBe("Chorus");
  });
});
