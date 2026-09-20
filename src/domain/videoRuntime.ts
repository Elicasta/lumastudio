import type { VideoClip, VideoProgram } from "./video";

export interface ActiveVideoClip {
  clip: VideoClip;
  sourceSeconds: number;
}

export function activeVideoClip(program: VideoProgram | undefined, positionSeconds: number, sectionId?: string): ActiveVideoClip | null {
  if (!program) return null;
  const candidates = program.clips.filter((clip) => {
    if (!clip.enabled) return false;
    if (clip.playbackMode === "section") return clip.sectionId === sectionId;
    if (clip.playbackMode === "manual") return false;
    return positionSeconds >= clip.timelineStartSeconds;
  });
  const clip = candidates[candidates.length - 1];
  if (!clip) return null;
  const elapsed = clip.playbackMode === "section" ? 0 : Math.max(0, positionSeconds - clip.timelineStartSeconds);
  const length = clip.sourceOutSeconds === undefined ? undefined : Math.max(0, clip.sourceOutSeconds - clip.sourceInSeconds);
  if (length !== undefined && length <= 0) return null;
  if (length !== undefined && elapsed >= length && !clip.loop) return null;
  const offset = length && clip.loop ? elapsed % length : elapsed;
  return { clip, sourceSeconds: clip.sourceInSeconds + offset };
}
