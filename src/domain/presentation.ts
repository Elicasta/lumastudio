import type { PresentationAutomation, PresentationCue, Song } from "./types";

export function defaultPresentationAutomation(): PresentationAutomation {
  return {
    mode: "manual",
    cueLeadBeats: 0,
    cues: []
  };
}

export function presentationAutomation(song: Song): PresentationAutomation {
  return song.presentation ?? defaultPresentationAutomation();
}

export function cueLeadSeconds(song: Song) {
  const automation = presentationAutomation(song);
  const bpm = Number.isFinite(song.bpm) && song.bpm > 0 ? song.bpm : 120;
  return Math.max(-8, Math.min(8, automation.cueLeadBeats)) * (60 / bpm);
}

export function effectiveCueTime(song: Song, cue: PresentationCue) {
  return Math.max(0, cue.atSeconds - cueLeadSeconds(song));
}

export function duePresentationCues(
  song: Song,
  previousSeconds: number,
  currentSeconds: number,
  firedIds: ReadonlySet<string>
) {
  const automation = presentationAutomation(song);
  if (automation.mode !== "full-auto" || currentSeconds < previousSeconds) return [];

  return automation.cues
    .filter((cue) => {
      if (firedIds.has(cue.id)) return false;
      const triggerAt = effectiveCueTime(song, cue);
      return triggerAt > previousSeconds && triggerAt <= currentSeconds + 0.02;
    })
    .sort((left, right) => effectiveCueTime(song, left) - effectiveCueTime(song, right));
}

export function cueIdsBeforePosition(song: Song, positionSeconds: number) {
  return new Set(
    presentationAutomation(song).cues
      .filter((cue) => effectiveCueTime(song, cue) <= positionSeconds)
      .map((cue) => cue.id)
  );
}

export function sortPresentationCues(cues: PresentationCue[]) {
  return [...cues].sort((a, b) => a.atSeconds - b.atSeconds || a.id.localeCompare(b.id));
}
