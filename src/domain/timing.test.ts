import { describe, expect, it } from "vitest";
import { goodness } from "./demo";
import {
  barBeatToSeconds,
  musicalPositionAtSeconds,
  planManualSectionJump,
  planSongCountIn,
  sectionIndexAtSeconds,
  sectionStartSeconds
} from "./timing";

describe("musical timing", () => {
  it("maps section starts from bars and tempo", () => {
    expect(sectionStartSeconds(goodness, 1)).toBeCloseTo((8 * 4 * 60) / 63, 5);
    expect(sectionIndexAtSeconds(goodness, 0)).toBe(0);
    expect(
      sectionIndexAtSeconds(goodness, sectionStartSeconds(goodness, 2) + 0.1)
    ).toBe(2);
  });

  it("anchors the musical grid to a detected downbeat", () => {
    const offsetSong = { ...goodness, downbeatSeconds: 0.842 };

    expect(sectionStartSeconds(offsetSong, 0)).toBeCloseTo(0.842, 5);
    expect(planSongCountIn(offsetSong).targetSeconds).toBeCloseTo(0.842, 5);
  });

  it("maps a bar and beat back onto the Song timeline", () => {
    const barNine = barBeatToSeconds(goodness, 9, 1);
    expect(barNine).toBeCloseTo(sectionStartSeconds(goodness, 1), 5);

    const beatThree = barBeatToSeconds(goodness, 9, 3);
    expect(beatThree - barNine).toBeCloseTo(2 * (60 / 63), 5);
  });

  it("derives the current bar and beat automatically", () => {
    const oneBeat = 60 / 63;
    const position = musicalPositionAtSeconds(goodness, oneBeat * 5.5);

    expect(position.bar).toBe(2);
    expect(position.beat).toBe(2);
    expect(position.beatProgress).toBeCloseTo(0.5, 4);
  });

  it("uses one full bar for the default song count-in", () => {
    const plan = planSongCountIn(goodness);

    expect(plan.countBeats).toBe(4);
    expect(plan.launchAfterSeconds).toBeCloseTo((4 * 60) / 63, 5);
  });

  it("makes one bar mean the actual meter instead of always four clicks", () => {
    const sixEight = {
      ...goodness,
      bpm: 72,
      meter: [6, 8] as [number, number]
    };
    const plan = planSongCountIn(sixEight);

    expect(plan.countBeats).toBe(6);
    expect(plan.beatSeconds).toBeCloseTo((60 / 72) * 0.5, 5);
  });

  it("can feel 6/8 in two without changing the underlying meter", () => {
    const sixEight = {
      ...goodness,
      bpm: 72,
      meter: [6, 8] as [number, number],
      guideVoice: {
        ...goodness.guideVoice,
        countFeel: "compound" as const
      }
    };
    const plan = planSongCountIn(sixEight);

    expect(plan.countBeats).toBe(2);
    expect(plan.beatSeconds).toBeCloseTo((60 / 72) * 1.5, 5);
    expect(plan.launchAfterSeconds).toBeCloseTo(2 * (60 / 72) * 1.5, 5);
  });

  it("calculates an adaptive manual jump from the middle of a bar", () => {
    const oneBeat = 60 / 63;
    // Beat 2, halfway through: next clean count is beat 3, then 4, then land on 1.
    const plan = planManualSectionJump(
      goodness,
      oneBeat * 1.5,
      goodness.sections[2]
    );

    expect(plan.countBeats).toBe(2);
    expect(plan.firstCountAfterSeconds).toBeCloseTo(oneBeat * 0.5, 5);
    expect(plan.launchAfterSeconds).toBeCloseTo(oneBeat * 2.5, 5);
    expect(plan.targetSectionId).toBe("chorus1");
  });

  it("takes a clean barline immediately without an unnecessary count", () => {
    const plan = planManualSectionJump(
      goodness,
      0,
      goodness.sections[2]
    );

    expect(plan.countBeats).toBe(0);
    expect(plan.launchAfterSeconds).toBe(0);
  });

  it("adds another bar if a late tap would not provide enough count-in", () => {
    const oneBeat = 60 / 63;
    // Beat 4, halfway through leaves no clean count beats before the barline.
    const plan = planManualSectionJump(
      goodness,
      oneBeat * 3.5,
      goodness.sections[5]
    );

    expect(plan.countBeats).toBe(4);
    expect(plan.launchAfterSeconds).toBeCloseTo(oneBeat * 4.5, 5);
  });

  it("establishes a destination tempo before a manual jump", () => {
    const target = {
      ...goodness.sections[5],
      tempoOverride: 84
    };
    const oneSourceBeat = 60 / 63;
    const plan = planManualSectionJump(
      goodness,
      oneSourceBeat * 1.5,
      target
    );

    expect(plan.countBeats).toBe(4);
    expect(plan.beatSeconds).toBeCloseTo(60 / 84, 5);
    expect(plan.firstCountAfterSeconds).toBeCloseTo(oneSourceBeat * 0.5, 5);
    expect(plan.launchAfterSeconds).toBeCloseTo(
      oneSourceBeat * 0.5 + 4 * (60 / 84),
      5
    );
  });

  it("uses the destination meter for a bar count-in override", () => {
    const target = {
      ...goodness.sections[5],
      meterOverride: [6, 8] as [number, number],
      countInOverride: { mode: "bars" as const, value: 1 }
    };
    const plan = planManualSectionJump(goodness, 1.2, target);

    expect(plan.countBeats).toBe(6);
    expect(plan.beatSeconds).toBeCloseTo((60 / 63) * 0.5, 5);
  });

  it("respects a section no-count override", () => {
    const target = {
      ...goodness.sections[3],
      countInOverride: { mode: "none" as const }
    };

    const plan = planManualSectionJump(goodness, 1.2, target);
    expect(plan.countBeats).toBe(0);
    expect(plan.launchAfterSeconds).toBeLessThanOrEqual(60 / 63);
  });
});
