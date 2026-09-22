import { useEffect, useState } from "react";
import { VideoProgram } from "./VideoProgram";
import { listenVideoOutputState, requestVideoOutputState, type VideoOutputSnapshot } from "../services/videoOutputState";
import { fullscreenVideoOutput } from "../services/videoOutput";

export function VideoOutputSurface() {
  const [snapshot, setSnapshot] = useState<VideoOutputSnapshot>({ positionSeconds: 0, playing: false });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void fullscreenVideoOutput(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);

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

  return <main className="standalone-video-output">
    <VideoProgram program={snapshot.program} positionSeconds={snapshot.positionSeconds} playing={snapshot.playing} sectionId={snapshot.sectionId} />
  </main>;
}
