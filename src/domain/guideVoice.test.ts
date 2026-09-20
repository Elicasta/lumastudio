import { describe, expect, it } from "vitest";
import { goodness } from "./demo";
import {
  planAutomaticSectionCue,
  planGuideCount,
  planSongStartGuide,
  requiredCoreVoiceTokens,
  sectionTokenForName
} from "./guideVoice";

describe("guide voice planner", () => {
  it("builds the standard Chorus, 2, 3, 4 cue", () => {
    const chorus = goodness.sections[2];
    const plan = planGuideCount({
      destination: chorus,
      totalCountPulses: 4,
      pulsesPerBar: 4
    });

    expect(plan.events.map((event) => event.token)).toEqual([
      "section.chorus",
      "count.2",
      "count.3",
      "count.4"
    ]);
    expect(plan.events.map((event) => event.offsetPulses)).toEqual([
      -4, -3, -2, -1
    ]);
  });

  it("uses only the final spoken bar for a two-bar count-in", () => {
    const plan = planGuideCount({
      destination: goodness.sections[5],
      totalCountPulses: 8,
      pulsesPerBar: 4
    });

    expect(plan.events.map((event) => event.token)).toEqual([
      "section.bridge",
      "count.2",
      "count.3",
      "count.4"
    ]);
    expect(plan.events[0].offsetPulses).toBe(-4);
  });

  it("adapts a short mid-bar jump to the remaining beat numbers", () => {
    const plan = planGuideCount({
      destination: goodness.sections[2],
      totalCountPulses: 2,
      pulsesPerBar: 4
    });

    expect(plan.events.map((event) => event.token)).toEqual([
      "section.chorus",
      "count.4"
    ]);
    expect(plan.events.map((event) => event.offsetPulses)).toEqual([-2, -1]);
  });

  it("handles odd meters without special phrase recordings", () => {
    const plan = planGuideCount({
      destination: goodness.sections[5],
      totalCountPulses: 5,
      pulsesPerBar: 5
    });

    expect(plan.events.map((event) => event.token)).toEqual([
      "section.bridge",
      "count.2",
      "count.3",
      "count.4",
      "count.5"
    ]);
  });

  it("strips Verse and Chorus ordinals down to reusable tokens", () => {
    expect(sectionTokenForName("Verse 2")).toBe("section.verse");
    expect(sectionTokenForName("Chorus 3")).toBe("section.chorus");
    expect(sectionTokenForName("Pre-Chorus 1")).toBe("section.prechorus");
  });

  it("plans normal automatic section announcements one bar early", () => {
    const plan = planAutomaticSectionCue(goodness, 2);
    expect(plan.events[0].token).toBe("section.chorus");
    expect(plan.events.at(-1)?.token).toBe("count.4");
  });

  it("uses the first Section label for Song start guide", () => {
    const plan = planSongStartGuide(goodness);
    expect(plan.events[0].token).toBe("section.intro");
    expect(plan.events).toHaveLength(4);
  });

  it("defines a finite reusable core voice vocabulary", () => {
    const tokens = requiredCoreVoiceTokens();
    expect(tokens).toContain("count.16");
    expect(tokens).toContain("section.vamp");
    expect(tokens).toContain("direction.last-time");
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
