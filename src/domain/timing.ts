import type { CountFeel, CountInSettings, Section, Song } from "./types";

export interface MusicalPosition {
  sectionIndex: number;
  bar: number;
  beat: number;
  beatProgress: number;
  bpm: number;
  meter: [number, number];
  beatSeconds: number;
}

export interface CountPulse {
  pulsesPerBar: number;
  pulseSeconds: number;
}

export interface ManualJumpPlan {
  targetSectionId: string;
  targetSeconds: number;
  launchAfterSeconds: number;
  countBeats: number;
  beatSeconds: number;
  pulsesPerBar: number;
  firstCountAfterSeconds: number;
  sourceBar: number;
  sourceBeat: number;
  destinationBar: number;
  mode: CountInSettings["mode"];
}

export function barBeatToSeconds(
  song: Song,
  bar: number,
  beat: number
): number {
  const safeBar = Math.max(1, Math.round(bar));
  const requestedBeat = Math.max(1, beat);

  let sectionIndex = 0;
  for (let index = 0; index < song.sections.length; index += 1) {
    const section = song.sections[index];
    if (section.startBar <= safeBar) {
      sectionIndex = index;
    } else {
      break;
    }
  }

  const section = song.sections[sectionIndex];
  if (!section) return Math.max(0, song.downbeatSeconds ?? 0);

  const meter = section.meterOverride ?? song.meter;
  const bpm = section.tempoOverride ?? song.bpm;
  const beatSeconds = secondsPerBeat(bpm, meter);
  const beatsPerBar = Math.max(1, meter[0]);
  const clampedBeat = Math.min(requestedBeat, beatsPerBar + 0.999999);
  const barsFromSection = Math.max(0, safeBar - section.startBar);

  return (
    sectionStartSeconds(song, sectionIndex) +
    barsFromSection * secondsPerBar(bpm, meter) +
    (clampedBeat - 1) * beatSeconds
  );
}

export function sectionStartSeconds(song: Song, sectionIndex: number): number {
  const safeIndex = Math.max(0, Math.min(song.sections.length - 1, sectionIndex));
  let seconds = Math.max(0, song.downbeatSeconds ?? 0);

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
  pulsesPerBar: number;
  launchAfterSeconds: number;
  targetSeconds: number;
} {
  const settings = song.countIn;
  const pulse = countPulseForMeter(
    song.bpm,
    song.meter,
    song.guideVoice.countFeel
  );
  const beatSeconds = pulse.pulseSeconds;
  const countBeats = resolveCountBeats(settings, pulse.pulsesPerBar);

  return {
    countBeats,
    beatSeconds,
    pulsesPerBar: pulse.pulsesPerBar,
    launchAfterSeconds: countBeats * beatSeconds,
    targetSeconds: Math.max(0, song.downbeatSeconds ?? 0)
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
  const targetBpm = targetSection.tempoOverride ?? song.bpm;
  const targetMeter = targetSection.meterOverride ?? song.meter;
  const targetPulse = countPulseForMeter(
    targetBpm,
    targetMeter,
    song.guideVoice.countFeel
  );
  const currentPulse = countPulseForMeter(
    current.bpm,
    current.meter,
    song.guideVoice.countFeel
  );
  const targetBeatSeconds = targetPulse.pulseSeconds;
  const targetMeterBeats = targetPulse.pulsesPerBar;
  const currentNotatedOffset =
    (current.beat - 1 + current.beatProgress) * current.beatSeconds;
  const currentPulseFloat = currentNotatedOffset / currentPulse.pulseSeconds;
  const currentPulseIndex = Math.floor(currentPulseFloat) + 1;
  const currentPulseProgress =
    currentPulseFloat - Math.floor(currentPulseFloat);
  const tempoChanges = Math.abs(targetBpm - current.bpm) > 0.001;
  const meterChanges =
    targetMeter[0] !== current.meter[0] ||
    targetMeter[1] !== current.meter[1];
  const targetSeconds = sectionStartSeconds(song, targetIndex);

  if (mode === "none") {
    const untilNextBeat =
      currentPulseProgress < 0.02
        ? 0
        : (1 - currentPulseProgress) * currentPulse.pulseSeconds;

    return {
      targetSectionId: targetSection.id,
      targetSeconds,
      launchAfterSeconds: untilNextBeat,
      countBeats: 0,
      beatSeconds: targetBeatSeconds,
      pulsesPerBar: targetPulse.pulsesPerBar,
      firstCountAfterSeconds: 0,
      sourceBar: current.bar,
      sourceBeat: current.beat,
      destinationBar: targetSection.startBar,
      mode
    };
  }

  if (mode === "beats" || mode === "bars") {
    const countBeats = resolveCountBeats(settings, targetMeterBeats);
    const firstCountAfterSeconds =
      currentPulseProgress < 0.02
        ? 0
        : (1 - currentPulseProgress) * currentPulse.pulseSeconds;

    return {
      targetSectionId: targetSection.id,
      targetSeconds,
      launchAfterSeconds:
        firstCountAfterSeconds + countBeats * targetBeatSeconds,
      countBeats,
      beatSeconds: targetBeatSeconds,
      pulsesPerBar: targetPulse.pulsesPerBar,
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
  if (
    !tempoChanges &&
    !meterChanges &&
    currentPulseIndex === 1 &&
    currentPulseProgress < 0.08
  ) {
    return {
      targetSectionId: targetSection.id,
      targetSeconds,
      launchAfterSeconds: 0,
      countBeats: 0,
      beatSeconds: targetBeatSeconds,
      pulsesPerBar: targetPulse.pulsesPerBar,
      firstCountAfterSeconds: 0,
      sourceBar: current.bar,
      sourceBeat: current.beat,
      destinationBar: targetSection.startBar,
      mode
    };
  }

  const firstCountAfterSeconds =
    currentPulseProgress < 0.02
      ? 0
      : (1 - currentPulseProgress) * currentPulse.pulseSeconds;

  if (tempoChanges || meterChanges) {
    const countBeats = Math.max(
      targetMeterBeats,
      settings.minBeats ?? 2
    );

    return {
      targetSectionId: targetSection.id,
      targetSeconds,
      launchAfterSeconds:
        firstCountAfterSeconds + countBeats * targetBeatSeconds,
      countBeats,
      beatSeconds: targetBeatSeconds,
      firstCountAfterSeconds,
      sourceBar: current.bar,
      sourceBeat: current.beat,
      destinationBar: targetSection.startBar,
      mode
    };
  }

  const currentMeterBeats = currentPulse.pulsesPerBar;
  const beatsRemainingInBar =
    currentPulseProgress < 0.02
      ? currentMeterBeats - currentPulseIndex + 1
      : currentMeterBeats - currentPulseIndex;

  const minimum = Math.max(1, settings.minBeats ?? 2);
  const countBeats =
    beatsRemainingInBar >= minimum
      ? beatsRemainingInBar
      : beatsRemainingInBar + currentMeterBeats;

  return {
    targetSectionId: targetSection.id,
    targetSeconds,
    launchAfterSeconds:
      firstCountAfterSeconds + countBeats * targetBeatSeconds,
    countBeats,
    beatSeconds: targetBeatSeconds,
    pulsesPerBar: targetPulse.pulsesPerBar,
    firstCountAfterSeconds,
    sourceBar: current.bar,
    sourceBeat: current.beat,
    destinationBar: targetSection.startBar,
    mode
  };
}

export function countPulseForMeter(
  bpm: number,
  meter: [number, number],
  feel: CountFeel
): CountPulse {
  const notatedPulseSeconds = secondsPerBeat(bpm, meter);
  const compound =
    feel === "compound" &&
    meter[1] === 8 &&
    meter[0] >= 6 &&
    meter[0] % 3 === 0;

  if (compound) {
    return {
      pulsesPerBar: meter[0] / 3,
      pulseSeconds: notatedPulseSeconds * 3
    };
  }

  return {
    pulsesPerBar: meter[0],
    pulseSeconds: notatedPulseSeconds
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
