import { useEffect, useRef, useState } from "react";

interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onError?: (event: { data: number }) => void;
      };
    }
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube player API loaded without a Player constructor."));
    };

    if (!document.querySelector('script[data-lumarig-youtube-api="1"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset.lumarigYoutubeApi = "1";
      script.onerror = () => reject(new Error("YouTube player API could not be loaded."));
      document.head.appendChild(script);
    }

    window.setTimeout(() => {
      if (!window.YT?.Player) reject(new Error("YouTube player API timed out."));
    }, 12000);
  });

  return apiPromise;
}

function youtubeErrorMessage(code: number) {
  if (code === 2) return "YouTube rejected this video ID or playback request.";
  if (code === 5) return "YouTube could not play this video in the embedded HTML5 player.";
  if (code === 100) return "This YouTube video is unavailable or private.";
  if (code === 101 || code === 150) return "This YouTube video does not allow embedded playback.";
  return `YouTube playback error (${code}).`;
}

export function YouTubeProgram({
  videoId,
  sourceSeconds,
  playing,
  title
}: {
  videoId: string;
  sourceSeconds: number;
  playing: boolean;
  title: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const syncRef = useRef({ sourceSeconds, atMs: performance.now() });
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    readyRef.current = false;

    void loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !mountRef.current) return;
        playerRef.current?.destroy();
        playerRef.current = new YT.Player(mountRef.current, {
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            rel: 0,
            playsinline: 1,
            enablejsapi: 1
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              readyRef.current = true;
              syncRef.current = { sourceSeconds, atMs: performance.now() };
              playerRef.current?.seekTo(sourceSeconds, true);
              if (playing) playerRef.current?.playVideo();
              else playerRef.current?.pauseVideo();
            },
            onError: (event) => setError(youtubeErrorMessage(event.data))
          }
        });
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));

    return () => {
      cancelled = true;
      readyRef.current = false;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;

    const sync = syncRef.current;
    const elapsed = playing ? (performance.now() - sync.atMs) / 1000 : 0;
    const expected = sync.sourceSeconds + elapsed;
    const drift = Math.abs(expected - sourceSeconds);

    if (!playing || drift > 0.85) {
      player.seekTo(sourceSeconds, true);
      syncRef.current = { sourceSeconds, atMs: performance.now() };
    }
  }, [sourceSeconds, playing]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    if (playing) player.playVideo();
    else player.pauseVideo();
    syncRef.current = { sourceSeconds, atMs: performance.now() };
  }, [playing]);

  return (
    <div className="youtube-program-shell" aria-label={title}>
      <div ref={mountRef} className="video-program-frame" />
      {error && <div className="youtube-program-error">{error}</div>}
    </div>
  );
}
