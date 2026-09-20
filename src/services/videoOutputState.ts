import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { VideoProgram } from "../domain/video";

export interface VideoOutputSnapshot {
  program?: VideoProgram;
  positionSeconds: number;
  playing: boolean;
  sectionId?: string;
}

const EVENT = "studio-video-output-state";

export async function publishVideoOutputState(snapshot: VideoOutputSnapshot) {
  await emit(EVENT, snapshot);
}

export async function listenVideoOutputState(handler: (snapshot: VideoOutputSnapshot) => void): Promise<UnlistenFn> {
  return listen<VideoOutputSnapshot>(EVENT, (event) => handler(event.payload));
}
