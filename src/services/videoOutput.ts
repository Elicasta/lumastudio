import { invoke } from "@tauri-apps/api/core";
import { isNativeApp } from "./audio";

export async function openVideoOutput() {
  if (!isNativeApp()) throw new Error("Program output is available in the desktop app.");
  await invoke("video_open_output");
}
export async function closeVideoOutput() { if (isNativeApp()) await invoke("video_close_output"); }
export async function fullscreenVideoOutput(fullscreen = true) {
  if (!isNativeApp()) throw new Error("Program output is available in the desktop app.");
  await invoke("video_fullscreen_output", { fullscreen });
}
