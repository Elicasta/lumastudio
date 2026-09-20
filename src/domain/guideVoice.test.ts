import { describe, expect, it } from "vitest";
import { goodness } from "./demo";
import { sectionStartSeconds } from "./timing";
import {
  buildAutomaticGuideTimeline,
  countPulseForSection,
  planAutomaticSectionCue,
  planGuideCount,
  planSongStartGuide,
  requiredCoreVoiceTokens,
  sectionTokenForName,
  validateVoicePackManifest
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

  it("builds reusable absolute automatic Guide events", () => {
    const events = buildAutomaticGuideTimeline(goodness);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((event) => event.token === "section.chorus")).toBe(true);
    expect(events.every((event) => event.atSeconds >= 0)).toBe(true);
  });

  it("shares compound pulse feel with the count engine", () => {
    const sixEight = {
      ...goodness,
      meter: [6, 8] as [number, number],
      guideVoice: {
        ...goodness.guideVoice,
        countFeel: "compound" as const
      }
    };
    const pulse = countPulseForSection(sixEight, sixEight.sections[0]);
    expect(pulse.pulsesPerBar).toBe(2);
  });

  it("adds reusable direction markers to the automatic native Guide timeline", () => {
    const song = {
      ...goodness,
      guideMarkers: [
        {
          id: "last-time-bridge",
          bar: 73,
          beat: 1,
          token: "direction.last-time",
          label: "Last Time"
        }
      ]
    };

    const events = buildAutomaticGuideTimeline(song);
    const marker = events.find((event) => event.token === "direction.last-time");

    expect(marker).toBeDefined();
    expect(marker?.atSeconds).toBeCloseTo(sectionStartSeconds(song, 5), 5);
  });

  it("preserves a custom recorded Guide token", () => {
    const song = {
      ...goodness,
      guideMarkers: [
        {
          id: "custom-cue",
          bar: 9,
          beat: 2,
          token: "custom.everybody-in"
        }
      ]
    };

    expect(
      buildAutomaticGuideTimeline(song).some(
        (event) => event.token === "custom.everybody-in"
      )
    ).toBe(true);
  });

  it("uses the first Section label for Song start guide", () => {
    const plan = planSongStartGuide(goodness);
    expect(plan.events[0].token).toBe("section.intro");
    expect(plan.events).toHaveLength(4);
  });

  it("accepts a complete reusable voice pack manifest", () => {
    const assets = requiredCoreVoiceTokens().map((token) => ({
      token,
      file: token + ".wav"
    }));
    const validation = validateVoicePackManifest({
      id: "core-en-neutral-f",
      name: "Core English Neutral Female",
      locale: "en-US",
      voice: "Neutral Female",
      version: 1,
      sampleRate: 48_000,
      channels: 1,
      assets
    });

    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("rejects an incomplete voice pack", () => {
    const validation = validateVoicePackManifest({
      id: "broken",
      name: "Broken",
      locale: "en-US",
      voice: "Test",
      version: 1,
      sampleRate: 48_000,
      channels: 1,
      assets: []
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain("Missing required voice token: count.1");
    expect(validation.errors).toContain("Missing required voice token: section.chorus");
  });

  it("defines a finite reusable core voice vocabulary", () => {
    const tokens = requiredCoreVoiceTokens();
    expect(tokens).toContain("count.16");
    expect(tokens).toContain("section.vamp");
    expect(tokens).toContain("direction.last-time");
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
