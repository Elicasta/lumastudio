import type { SectionCueDispatch } from "../domain/cues";
import type { VideoProgram } from "../domain/video";
import type { LumaRigCommandResult } from "../lumarig/protocol";

export interface CueDispatchContext {
  video?: VideoProgram;
  sendLumaRig?: (command: { type: "scene.fire"; sceneId: string }) => Promise<LumaRigCommandResult>;
  sendMidiPatch?: (patch: string) => Promise<void>;
  midiConnected?: boolean;
}

export interface CueDispatchResult { videoClipId?: string; lighting?: boolean; midi?: boolean; errors: string[]; }

export async function dispatchSectionCue(cue: SectionCueDispatch, context: CueDispatchContext): Promise<CueDispatchResult> {
  const result: CueDispatchResult = { errors: [] };
  const sectionVideo = context.video?.clips.find((clip) => clip.enabled && (clip.id === cue.videoCue || clip.sectionId === cue.sectionId));
  if (sectionVideo) result.videoClipId = sectionVideo.id;

  if (cue.lightingCue && context.sendLumaRig) {
    try { const response = await context.sendLumaRig({ type: "scene.fire", sceneId: cue.lightingCue }); result.lighting = response.ok; if (!response.ok) result.errors.push(response.error ?? "LumaRig cue failed."); }
    catch (error) { result.errors.push(error instanceof Error ? error.message : String(error)); }
  }
  if (cue.midiPatch && context.sendMidiPatch && context.midiConnected) {
    try { await context.sendMidiPatch(cue.midiPatch); result.midi = true; }
    catch (error) { result.errors.push(error instanceof Error ? error.message : String(error)); }
  }
  return result;
}
