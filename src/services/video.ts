import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { createVideoClip, youtubeVideoId, type VideoClip } from "../domain/video";
import { isNativeApp } from "./audio";

export async function chooseLocalVideo(): Promise<VideoClip | null> {
  if (!isNativeApp()) throw new Error("Local video can be selected in the LumaRig Studio desktop app.");
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Video", extensions: ["mp4", "mov"] }]
  });
  if (!selected || Array.isArray(selected)) return null;
  const filename = selected.split(/[\\/]/).pop() ?? "Video";
  const format = selected.toLowerCase().endsWith(".mov") ? "mov" : "mp4";
  return createVideoClip({ kind: "local", path: selected, format }, filename.replace(/\.(mp4|mov)$/i, ""));
}

export function createYouTubeClip(url: string): VideoClip {
  const videoId = youtubeVideoId(url);
  if (!videoId) throw new Error("Enter a valid YouTube video, Shorts, or youtu.be link.");
  return createVideoClip({ kind: "youtube", url, videoId }, "YouTube " + videoId);
}

export function localVideoUrl(path: string) {
  return convertFileSrc(path);
}

export function youtubeEmbedUrl(videoId: string, startSeconds: number, endSeconds?: number) {
  const params = new URLSearchParams({
    autoplay: "1",
    controls: "0",
    rel: "0",
    playsinline: "1",
    start: String(Math.max(0, Math.floor(startSeconds)))
  });
  if (endSeconds !== undefined) params.set("end", String(Math.max(0, Math.floor(endSeconds))));
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}
