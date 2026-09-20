import { useEffect, useRef } from "react";
import type { VideoProgram as VideoProgramModel } from "../domain/video";
import { activeVideoClip } from "../domain/videoRuntime";
import { localVideoUrl, youtubeEmbedUrl } from "../services/video";

export function VideoProgram({ program, positionSeconds, playing, sectionId, preview = false }: {
  program?: VideoProgramModel;
  positionSeconds: number;
  playing: boolean;
  sectionId?: string;
  preview?: boolean;
}) {
  const resolved = activeVideoClip(program, positionSeconds, sectionId);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resolved || resolved.clip.source.kind !== "local") return;
    if (Math.abs(video.currentTime - resolved.sourceSeconds) > 0.35) video.currentTime = resolved.sourceSeconds;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [resolved?.clip.id, resolved?.sourceSeconds, playing]);

  if (!resolved) return <div className="video-program-clear">{preview ? "No active clip at playhead" : null}</div>;
  const { clip, sourceSeconds } = resolved;
  if (clip.source.kind === "youtube") {
    return <iframe className="video-program-frame" src={youtubeEmbedUrl(clip.source.videoId, sourceSeconds, clip.sourceOutSeconds)} allow="autoplay; encrypted-media; picture-in-picture" title={clip.name} />;
  }
  return <video ref={videoRef} className="video-program-frame" src={localVideoUrl(clip.source.path)} loop={clip.loop} playsInline />;
}
