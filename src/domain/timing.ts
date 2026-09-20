import type { CountInSettings, Section, Song } from "./types";

export interface MusicalPosition {
  sectionIndex: number;
  bar: number;
  beat: number;
  beatProgress: number;
  bpm: number;
  meter: [number, number];
  beatSeconds: number;
}

export interface ManualJumpPlan {
  targetSectionId: string;
  targetSeconds: number;
  launchAfterSeconds: number;
  countBeats: number;
  beatSeconds: number;
  firstCountAfterSeconds: number;
  sourceBar: number;
  sourceBeat: number;
  destinationBar: number;
  mode: CountInSettings["mode"];
}

export function sectionStartSeconds(song: Song, sectionIndex: number): number {
  const safeIndex = Math.max(0, Math.min(song.sections.length - 1, sectionIndex));
  let seconds = 0;

  for (let index = 0; index < safeIndex; index += 1) {
    const section = song.sections[index];
    const next = song.sections[index + 1];
    if (!section || !next) break;

    const bars = Math.max(0, next.startBar - section.startBar);
    const bpm = section.tempoOverride ?? song.bpm;
    const meter = section.meterOverride ?? song.meter;
    seconds += bars * secondsPerBar(bpm, meter);
  }

  return seconds;
}

export function sectionIndexAtSeconds(song: Song, seconds: number): number {
  if (song.sections.length === 0) return 0;

  const time = Math.max(0, seconds);

  for (let index = song.sections.length - 1; index >= 0; index -= 1) {
    if (time + 0.001 >= sectionStartSeconds(song, index)) return index;
  }

  return 0;
}

export function musicalPositionAtSeconds(
  song: Song,
  seconds: number
): MusicalPosition {
  const sectionIndex = sectionIndexAtSeconds(song, seconds);
  const section = song.sections[sectionIndex];
  const bpm = section?.tempoOverride ?? song.bpm;
  const meter = section?.meterOverride ?? song.meter;
  const beatSeconds = secondsPerBeat(bpm, meter);
  const sectionStart = sectionStartSeconds(song, sectionIndex);
  const elapsed = Math.max(0, seconds - sectionStart);
  const beatFloat = elapsed / beatSeconds;
  const beatsPerBar = meter[0];
  const barOffset = Math.floor(beatFloat / beatsPerBar);
  const beatInBarFloat = beatFloat - barOffset * beatsPerBar;
  const beat = Math.floor(beatInBarFloat) + 1;
  const beatProgress = beatInBarFloat - Math.floor(beatInBarFloat);

  return {
    sectionIndex,
    bar: (section?.startBar ?? 1) + barOffset,
    beat,
    beatProgress,
    bpm,
    meter,
    beatSeconds
  };
}

export function planSongCountIn(song: Song): {
  countBeats: number;
  beatSeconds: number;
  launchAfterSeconds: number;
} {
  const settings = song.countIn;
  const beatSeconds = secondsPerBeat(song.bpm, song.meter);
  const countBeats = resolveCountBeats(settings, song.meter[0]);

  return {
    countBeats,
    beatSeconds,
    launchAfterSeconds: countBeats * beatSeconds
  };
}

export function planManualSectionJump(
  song: Song,
  fromSeconds: number,
  targetSection: Section
): ManualJumpPlan {
  const current = musicalPositionAtSeconds(song, fromSeconds);
  const targetIndex = Math.max(
    0,
    song.sections.findIndex((section) => section.id === targetSection.id)
  );
  const settings = targetSection.countInOverride ?? song.manualJumpCountIn;
  const mode = settings.mode;
  const meterBeats = current.meter[0];
  const targetSeconds = sectionStartSeconds(song, targetIndex);

  if (mode === "none") {
    const untilNextBeat =
      current.beatProgress < 0.02
        ? 0
        : (1 - current.beatProgress) * current.beatSeconds;

    return {
      targetSectionId: targetSection.id,
      targetSeconds,
      launchAfterSeconds: untilNextBeat,
      countBeats: 0,
      beatSeconds: current.beatSeconds,
      firstCountAfterSeconds: 0,
      sourceBar: current.bar,
      sourceBeat: current.beat,
      destinationBar: targetSection.startBar,
      mode
    };
  }

  if (mode === "beats" || mode === "bars") {
    const countBeats = resolveCountBeats(settings, meterBeats);
    const firstCountAfterSeconds =
      current.beatProgress < 0.02
        ? 0
        : (1 - current.beatProgress) * current.beatSeconds;

    return {
      targetSectionId: targetSection.id,
      targetSeconds,
      launchAfterSeconds:
        firstCountAfterSeconds + countBeats * current.beatSeconds,
      countBeats,
      beatSeconds: current.beatSeconds,
      firstCountAfterSeconds,
      sourceBar: current.bar,
      sourceBeat: current.beat,
      destinationBar: targetSection.startBar,
      mode
    };
  }

  // Adaptive manual jump: if the operator lands almost exactly on a barline,
  // take the clean downbeat immediately. Otherwise start counting on the next
  // clean beat and land on a later barline. If there are too few beats left to
  // establish time, wait one additional bar before the destination jump.
  if (current.beat === 1 && current.beatProgress < 0.08) {
    return {
      targetSectionId: targetSection.id,
      targetSeconds,
      launchAfterSeconds: 0,
      countBeats: 0,
      beatSeconds: current.beatSeconds,
      firstCountAfterSeconds: 0,
      sourceBar: current.bar,
      sourceBeat: current.beat,
      destinationBar: targetSection.startBar,
      mode
    };
  }

  const firstCountAfterSeconds =
    current.beatProgress < 0.02
      ? 0
      : (1 - current.beatProgress) * current.beatSeconds;

  const beatsRemainingInBar =
    current.beatProgress < 0.02
      ? meterBeats - current.beat + 1
      : meterBeats - current.beat;

  const minimum = Math.max(1, settings.minBeats ?? 2);
  const countBeats =
    beatsRemainingInBar >= minimum
      ? beatsRemainingInBar
      : beatsRemainingInBar + meterBeats;

  return {
    targetSectionId: targetSection.id,
    targetSeconds,
    launchAfterSeconds:
      firstCountAfterSeconds + countBeats * current.beatSeconds,
    countBeats,
    beatSeconds: current.beatSeconds,
    firstCountAfterSeconds,
    sourceBar: current.bar,
    sourceBeat: current.beat,
    destinationBar: targetSection.startBar,
    mode
  };
}

export function secondsPerBeat(
  bpm: number,
  meter: [number, number]
): number {
  const safeBpm = Math.max(1, bpm);
  const denominator = Math.max(1, meter[1]);
  return (60 / safeBpm) * (4 / denominator);
}

export function secondsPerBar(
  bpm: number,
  meter: [number, number]
): number {
  return secondsPerBeat(bpm, meter) * Math.max(1, meter[0]);
}

function resolveCountBeats(
  settings: CountInSettings,
  beatsPerBar: number
): number {
  if (settings.mode === "none") return 0;
  if (settings.mode === "bars") {
    return Math.max(0, Math.round(settings.value ?? 1)) * beatsPerBar;
  }
  if (settings.mode === "beats") {
    return Math.max(0, Math.round(settings.value ?? beatsPerBar));
  }
  return Math.max(0, settings.minBeats ?? 2);
}
