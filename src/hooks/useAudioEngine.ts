import { useCallback, useEffect, useState } from "react";
import {
  audioPause,
  audioPlay,
  audioSeek,
  audioStop,
  audioScheduleTransition,
  audioCancelTransition,
  chooseWavTracks,
  getAudioStatus,
  loadWavSong,
  setNativeTrackGain,
  setNativeTrackMuted,
  setNativeTrackSolo,
  type NativeAudioStatus,
  type NativeAudioTrack
} from "../services/audio";

export function useAudioEngine() {
  const [status, setStatus] = useState<NativeAudioStatus>({ initialized: false });
  const [tracks, setTracks] = useState<NativeAudioTrack[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getAudioStatus());
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status.initialized) return;

    const timer = window.setInterval(() => {
      void refresh();
    }, status.playing || status.countInActive ? 50 : 300);

    return () => window.clearInterval(timer);
  }, [refresh, status.countInActive, status.initialized, status.playing]);

  const chooseAndLoad = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const selected = await chooseWavTracks();
      if (selected.length === 0) return null;

      const nextStatus = await loadWavSong(selected);
      setTracks(selected);
      setStatus(nextStatus);
      return { tracks: selected, status: nextStatus };
    } catch (cause) {
      setError(messageOf(cause));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const playPause = useCallback(async () => {
    setError(null);
    try {
      const next = status.playing ? await audioPause() : await audioPlay();
      setStatus(next);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [status.playing]);

  const stop = useCallback(async () => {
    setError(null);
    try {
      setStatus(await audioStop());
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  const seek = useCallback(async (seconds: number) => {
    setError(null);
    try {
      setStatus(await audioSeek(seconds));
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);
  const scheduleTransition = useCallback(async (options: {
    targetSeconds: number;
    delaySeconds: number;
    firstCountDelaySeconds: number;
    beatSeconds: number;
    countBeats: number;
    keepAudio: boolean;
  }) => {
    setError(null);
    try {
      setStatus(await audioScheduleTransition(options));
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  const cancelTransition = useCallback(async () => {
    setError(null);
    try {
      setStatus(await audioCancelTransition());
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);


  return {
    status,
    tracks,
    busy,
    error,
    hasLoadedAudio: (status.loadedTracks ?? 0) > 0,
    refresh,
    chooseAndLoad,
    playPause,
    stop,
    seek,
    scheduleTransition,
    cancelTransition,
    setTrackGain: setNativeTrackGain,
    setTrackMuted: setNativeTrackMuted,
    setTrackSolo: setNativeTrackSolo
  };
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

export type AudioEngineController = ReturnType<typeof useAudioEngine>;
