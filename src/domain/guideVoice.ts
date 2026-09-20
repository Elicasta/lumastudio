import {
  countPulseForMeter,
  sectionStartSeconds,
  type CountPulse
} from "./timing";
import type {
  GuideVoiceSettings,
  Section,
  Song
} from "./types";

export const CORE_COUNT_TOKENS = Array.from(
  { length: 16 },
  (_, index) => `count.${index + 1}` as const
);

export const CORE_SECTION_TOKENS = [
  "section.intro",
  "section.verse",
  "section.prechorus",
  "section.chorus",
  "section.refrain",
  "section.bridge",
  "section.tag",
  "section.vamp",
  "section.turnaround",
  "section.instrumental",
  "section.interlude",
  "section.breakdown",
  "section.build",
  "section.drop",
  "section.solo",
  "section.outro",
  "section.ending"
] as const;

export const CORE_DIRECTION_TOKENS = [
  "direction.hold",
  "direction.stop",
  "direction.repeat",
  "direction.again",
  "direction.last-time",
  "direction.one-more",
  "direction.two-more",
  "direction.build",
  "direction.down",
  "direction.big",
  "direction.soft"
] as const;

export type CountToken = `count.${number}`;
export type SectionToken = (typeof CORE_SECTION_TOKENS)[number];
export type DirectionToken = (typeof CORE_DIRECTION_TOKENS)[number];
export type GuideToken = CountToken | SectionToken | DirectionToken | string;

export interface VoiceAsset {
  token: GuideToken;
  file: string;
  onsetMs?: number;
  gainDb?: number;
}

export interface VoicePackManifest {
  id: string;
  name: string;
  locale: string;
  voice: string;
  version: number;
  sampleRate: number;
  channels: 1 | 2;
  assets: VoiceAsset[];
}

export interface GuideCueEvent {
  /** Pulse offset relative to destination beat 1. Negative values happen before it. */
  offsetPulses: number;
  token: GuideToken;
  spokenText: string;
  role: "section" | "count" | "direction";
}

export interface GuideCuePlan {
  destinationSectionId?: string;
  destinationName?: string;
  pulseCount: number;
  events: GuideCueEvent[];
}

export const DEFAULT_GUIDE_SETTINGS: GuideVoiceSettings = {
  voicePackId: "core-en-neutral-f",
  outputMode: "voice-and-click",
  sectionCues: "automatic",
  announceFirstSection: true,
  voiceFinalBarOnly: true,
  countFeel: "notated"
};

/**
 * Plans the final spoken count bar before a destination.
 *
 * The first spoken slot is normally the destination Section name:
 *   Chorus, 2, 3, 4
 *
 * For a short adaptive jump in 4/4 with only two pulses available:
 *   Chorus, 4
 *
 * If the transition has more than one bar of count, only the final bar is
 * voiced by default; earlier bars can remain click-only.
 */
export function planGuideCount({
  destination,
  totalCountPulses,
  pulsesPerBar,
  announceSection = true,
  voiceFinalBarOnly = true
}: {
  destination?: Section;
  totalCountPulses: number;
  pulsesPerBar: number;
  announceSection?: boolean;
  voiceFinalBarOnly?: boolean;
}): GuideCuePlan {
  const safePulsesPerBar = clampInteger(pulsesPerBar, 1, 16);
  const total = Math.max(0, Math.round(totalCountPulses));

  if (total === 0) {
    return {
      destinationSectionId: destination?.id,
      destinationName: destination?.name,
      pulseCount: 0,
      events: []
    };
  }

  const spokenPulses = voiceFinalBarOnly
    ? Math.min(total, safePulsesPerBar)
    : total;
  const firstSpokenAbsolutePulse = total - spokenPulses + 1;
  const events: GuideCueEvent[] = [];

  for (let slot = 0; slot < spokenPulses; slot += 1) {
    const absolutePulse = firstSpokenAbsolutePulse + slot;
    const offsetPulses = absolutePulse - total - 1;
    const beatInBar =
      ((offsetPulses % safePulsesPerBar) + safePulsesPerBar) %
        safePulsesPerBar +
      1;

    if (slot === 0 && announceSection && destination) {
      const sectionToken = sectionTokenForName(destination.name);
      if (sectionToken) {
        events.push({
          offsetPulses,
          token: sectionToken,
          spokenText: spokenSectionLabel(destination.name),
          role: "section"
        });
        continue;
      }
    }

    events.push({
      offsetPulses,
      token: countToken(beatInBar),
      spokenText: String(beatInBar),
      role: "count"
    });
  }

  return {
    destinationSectionId: destination?.id,
    destinationName: destination?.name,
    pulseCount: total,
    events
  };
}

export function planAutomaticSectionCue(
  song: Song,
  sectionIndex: number,
  pulsesPerBar = countPulseForSection(song, song.sections[sectionIndex]).pulsesPerBar
): GuideCuePlan {
  const section = song.sections[sectionIndex];
  if (!section || sectionIndex === 0) {
    return {
      destinationSectionId: section?.id,
      destinationName: section?.name,
      pulseCount: 0,
      events: []
    };
  }

  return planGuideCount({
    destination: section,
    totalCountPulses: pulsesPerBar,
    pulsesPerBar,
    announceSection: true,
    voiceFinalBarOnly: song.guideVoice.voiceFinalBarOnly
  });
}

export function planSongStartGuide(song: Song): GuideCuePlan {
  const firstSection = song.sections[0];
  const meter = firstSection?.meterOverride ?? song.meter;
  const pulsesPerBar = countPulseForSection(song, firstSection).pulsesPerBar;
  const bars =
    song.countIn.mode === "bars"
      ? Math.max(0, Math.round(song.countIn.value ?? 1))
      : 0;
  const totalCountPulses =
    song.countIn.mode === "none"
      ? 0
      : song.countIn.mode === "beats"
        ? Math.max(0, Math.round(song.countIn.value ?? pulsesPerBar))
        : bars > 0
          ? bars * pulsesPerBar
          : Math.max(0, song.countIn.minBeats ?? pulsesPerBar);

  return planGuideCount({
    destination: firstSection,
    totalCountPulses,
    pulsesPerBar,
    announceSection: song.guideVoice.announceFirstSection,
    voiceFinalBarOnly: song.guideVoice.voiceFinalBarOnly
  });
}

export function countPulseForSection(
  song: Song,
  section?: Section
): CountPulse {
  const meter = section?.meterOverride ?? song.meter;
  const bpm = section?.tempoOverride ?? song.bpm;
  return countPulseForMeter(bpm, meter, song.guideVoice.countFeel);
}

export function buildAutomaticGuideTimeline(song: Song): Array<{
  atSeconds: number;
  token: string;
  gainDb?: number;
}> {
  if (
    song.guideVoice.sectionCues !== "automatic" ||
    song.guideVoice.outputMode === "off" ||
    song.guideVoice.outputMode === "click-only"
  ) {
    return [];
  }

  const events: Array<{
    atSeconds: number;
    token: string;
    gainDb?: number;
  }> = [];

  for (let index = 1; index < song.sections.length; index += 1) {
    const destination = song.sections[index];
    const pulse = countPulseForSection(song, destination);
    const plan = planAutomaticSectionCue(song, index, pulse.pulsesPerBar);
    const destinationSeconds = sectionStartSeconds(song, index);

    for (const event of plan.events) {
      const atSeconds =
        destinationSeconds + event.offsetPulses * pulse.pulseSeconds;
      if (atSeconds < 0) continue;
      events.push({
        atSeconds,
        token: event.token
      });
    }
  }

  return events.sort((a, b) => a.atSeconds - b.atSeconds);
}

export function sectionTokenForName(name: string): SectionToken | null {
  const normalized = name
    .toLowerCase()
    .replace(/[0-9]+/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim();

  const aliases: Array<[RegExp, SectionToken]> = [
    [/^intro/, "section.intro"],
    [/^verse/, "section.verse"],
    [/^(pre chorus|prechorus)/, "section.prechorus"],
    [/^chorus/, "section.chorus"],
    [/^refrain/, "section.refrain"],
    [/^bridge/, "section.bridge"],
    [/^tag/, "section.tag"],
    [/^vamp/, "section.vamp"],
    [/^turnaround/, "section.turnaround"],
    [/^(instrumental|inst)/, "section.instrumental"],
    [/^interlude/, "section.interlude"],
    [/^breakdown/, "section.breakdown"],
    [/^build/, "section.build"],
    [/^drop/, "section.drop"],
    [/^solo/, "section.solo"],
    [/^outro/, "section.outro"],
    [/^(ending|end)/, "section.ending"]
  ];

  for (const [pattern, token] of aliases) {
    if (pattern.test(normalized)) return token;
  }

  return null;
}

export function spokenSectionLabel(name: string): string {
  return name
    .replace(/[0-9]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function countToken(value: number): CountToken {
  return `count.${clampInteger(value, 1, 16)}`;
}

export function requiredCoreVoiceTokens(): GuideToken[] {
  return [
    ...CORE_COUNT_TOKENS,
    ...CORE_SECTION_TOKENS,
    ...CORE_DIRECTION_TOKENS
  ];
}


export interface VoicePackValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateVoicePackManifest(
  manifest: VoicePackManifest
): VoicePackValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest.id.trim()) errors.push("Voice pack id is required.");
  if (!manifest.name.trim()) errors.push("Voice pack name is required.");
  if (!manifest.locale.trim()) errors.push("Voice pack locale is required.");
  if (!manifest.voice.trim()) errors.push("Voice label is required.");
  if (!Number.isInteger(manifest.version) || manifest.version < 1) {
    errors.push("Voice pack version must be a positive integer.");
  }
  if (manifest.sampleRate < 8_000 || manifest.sampleRate > 192_000) {
    errors.push("Voice pack sample rate is outside the supported range.");
  }
  if (manifest.channels !== 1 && manifest.channels !== 2) {
    errors.push("Voice pack channels must be mono or stereo.");
  }

  const seen = new Set<string>();
  for (const asset of manifest.assets) {
    if (seen.has(asset.token)) {
      errors.push("Duplicate voice token: " + asset.token);
    }
    seen.add(asset.token);

    if (!asset.file.trim()) {
      errors.push("Voice token has no file: " + asset.token);
    }
    if (asset.onsetMs !== undefined && asset.onsetMs < 0) {
      errors.push("Voice token has a negative onset: " + asset.token);
    }
    if (
      asset.gainDb !== undefined &&
      (!Number.isFinite(asset.gainDb) || asset.gainDb < -60 || asset.gainDb > 24)
    ) {
      errors.push("Voice token has an invalid gain trim: " + asset.token);
    }
  }

  for (const token of requiredCoreVoiceTokens()) {
    if (!seen.has(token)) {
      errors.push("Missing required voice token: " + token);
    }
  }

  for (const asset of manifest.assets) {
    if (!requiredCoreVoiceTokens().includes(asset.token)) {
      warnings.push("Optional or custom voice token: " + asset.token);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
