import { useEffect, useState } from "react";
import { VideoProgram } from "./VideoProgram";
import { listenVideoOutputState, type VideoOutputSnapshot } from "../services/videoOutputState";

export function VideoOutputSurface() {
  const [snapshot, setSnapshot] = useState<VideoOutputSnapshot>({ positionSeconds: 0, playing: false });

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenVideoOutputState((next) => setSnapshot(next)).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  return <main className="standalone-video-output">
    <VideoProgram program={snapshot.program} positionSeconds={snapshot.positionSeconds} playing={snapshot.playing} sectionId={snapshot.sectionId} />
  </main>;
}
