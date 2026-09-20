import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { VideoProgram } from "../domain/video";

export interface VideoOutputSnapshot {
  program?: VideoProgram;
  positionSeconds: number;
  playing: boolean;
  sectionId?: string;
}

const EVENT = "studio-video-output-state";
const REQUEST_EVENT = "studio-video-output-request";

export async function publishVideoOutputState(snapshot: VideoOutputSnapshot) {
  await emit(EVENT, snapshot);
}

export async function listenVideoOutputState(handler: (snapshot: VideoOutputSnapshot) => void): Promise<UnlistenFn> {
  return listen<VideoOutputSnapshot>(EVENT, (event) => handler(event.payload));
}

export async function requestVideoOutputState() { await emit(REQUEST_EVENT); }
export async function listenVideoOutputRequests(handler: () => void): Promise<UnlistenFn> {
  return listen(REQUEST_EVENT, () => handler());
}
