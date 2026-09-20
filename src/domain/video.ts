export type VideoSource =
  | { kind: "local"; path: string; format: "mp4" | "mov" }
  | { kind: "youtube"; url: string; videoId: string };

export type VideoPlaybackMode = "timeline" | "section" | "manual";

export interface VideoClip {
  id: string;
  name: string;
  source: VideoSource;
  timelineStartSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds?: number;
  sectionId?: string;
  loop: boolean;
  playbackMode: VideoPlaybackMode;
  enabled: boolean;
}

export type VideoProgramState = "live" | "black" | "clear" | "freeze";

export interface VideoProgram {
  clips: VideoClip[];
  state?: VideoProgramState;
  output: {
    displayEnabled: boolean;
    displayId?: string;
    ndiEnabled: boolean;
    ndiName: string;
  };
}

export function youtubeVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const match = url.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/);
      return match?.[1] ?? null;
    }
  } catch { return null; }
  return null;
}

export function createVideoClip(source: VideoSource, name: string): VideoClip {
  return {
    id: crypto.randomUUID(),
    name,
    source,
    timelineStartSeconds: 0,
    sourceInSeconds: 0,
    loop: false,
    playbackMode: "timeline",
    enabled: true
  };
}
