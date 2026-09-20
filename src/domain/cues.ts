import type { Section, Song } from "./types";

export interface SectionCueDispatch {
  songId: string;
  sectionId: string;
  sectionName: string;
  bpm: number;
  videoCue?: string;
  lightingCue?: string;
  midiPatch?: string;
}

export function sectionCueDispatch(song: Song, section: Section): SectionCueDispatch {
  return { songId: song.id, sectionId: section.id, sectionName: section.name, bpm: section.tempoOverride ?? song.bpm, videoCue: section.videoCue, lightingCue: section.lightingCue, midiPatch: section.midiPatch };
}
