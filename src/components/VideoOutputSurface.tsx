import { useEffect, useRef, useState } from "react";
import { VideoProgram } from "./VideoProgram";
import { listenVideoOutputState, requestVideoOutputState, type VideoOutputSnapshot } from "../services/videoOutputState";
import { fullscreenVideoOutput } from "../services/videoOutput";

export function VideoOutputSurface() {
  const [snapshot, setSnapshot] = useState<VideoOutputSnapshot>({ positionSeconds: 0, playing: false });
  const surfaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void fullscreenVideoOutput(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => surfaceRef.current?.focus(), 0);

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenVideoOutputState((next) => setSnapshot(next)).then((stop) => {
      if (disposed) stop(); else { unlisten = stop; void requestVideoOutputState(); }
    });
    return () => {
      disposed = true;
      window.removeEventListener("keydown", onKeyDown);
      unlisten?.();
    };
  }, []);

  return <main ref={surfaceRef} tabIndex={0} className="standalone-video-output">
    <VideoProgram program={snapshot.program} positionSeconds={snapshot.positionSeconds} playing={snapshot.playing} sectionId={snapshot.sectionId} />
  </main>;
}
