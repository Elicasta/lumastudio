import { useCallback, useEffect, useState } from "react";
import {
  audioPause,
  audioPlay,
  audioSeek,
  audioStop,
  audioScheduleTransition,
  audioCancelTransition,
  audioTrackFromPath,
  chooseVoicePackDirectory,
  chooseAudioTracks,
  getAudioStatus,
  listAudioOutputDevices,
  selectAudioOutputDevice,
  isNativeApp,
  loadVoicePack,
  loadAudioSong,
  setGuideTimeline,
  setNativeBusGain,
  setNativeBusMuted,
  setNativeBusRoute,
  setNativeTrackGain,
  setNativeTrackMuted,
  setNativeTrackSolo,
  type NativeAudioOutputDevice,
  type NativeAudioStatus,
  type NativeAudioTrack,
  type NativeGuideTimelineEvent
} from "../services/audio";

const VOICE_PACK_PATH_KEY = "lumarig.audio.voice-pack-path";
const BUS_SETTINGS_KEY = "lumarig.audio.bus-settings";

type RoutableBus = "music" | "click" | "guide";
type AudioBusId = RoutableBus | "master";

interface SavedBusSetting {
  gainDb?: number;
  muted?: boolean;
  outputLeft?: number;
  outputRight?: number;
}

type SavedBusSettings = Partial<Record<AudioBusId, SavedBusSetting>>;

export function useAudioEngine() {
  const [status, setStatus] = useState<NativeAudioStatus>({ initialized: false });
  const [tracks, setTracks] = useState<NativeAudioTrack[]>([]);
  const [outputDevices, setOutputDevices] = useState<NativeAudioOutputDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getAudioStatus());
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  const refreshOutputDevices = useCallback(async () => {
    try {
      setOutputDevices(await listAudioOutputDevices());
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    void refreshOutputDevices();
  }, [refreshOutputDevices]);

  useEffect(() => {
    const savedVoicePack = localStorage.getItem(VOICE_PACK_PATH_KEY);

    if (!savedVoicePack || !isNativeApp()) {
      void refresh();
      return;
    }

    void loadVoicePack(savedVoicePack)
      .then(setStatus)
      .catch((cause) => {
        localStorage.removeItem(VOICE_PACK_PATH_KEY);
        setError(
          "Saved Guide voice pack could not be loaded: " + messageOf(cause)
        );
        void refresh();
      });
  }, [refresh]);

  useEffect(() => {
    if (!status.initialized) return;

    const saved = readSavedBusSettings();
    if (!saved) return;

    void (async () => {
      try {
        for (const id of ["music", "click", "guide", "master"] as const) {
          const setting = saved[id];
          if (!setting) continue;

          if (typeof setting.gainDb === "number") {
            await setNativeBusGain(id, setting.gainDb);
          }
          if (typeof setting.muted === "boolean") {
            await setNativeBusMuted(id, setting.muted);
          }
          if (
            id !== "master" &&
            typeof setting.outputLeft === "number" &&
            typeof setting.outputRight === "number" &&
            setting.outputLeft <= (status.outputChannels ?? 2) &&
            setting.outputRight <= (status.outputChannels ?? 2)
          ) {
            await setNativeBusRoute(
              id,
              setting.outputLeft,
              setting.outputRight
            );
          }
        }

        setStatus(await getAudioStatus());
      } catch (cause) {
        setError("Saved audio routing could not be restored: " + messageOf(cause));
      }
    })();
  }, [status.initialized, status.outputChannels]);

  useEffect(() => {
    if (!status.initialized) return;

    const timer = window.setInterval(() => {
      void refresh();
    }, status.playing || status.transitionActive ? 50 : 300);

    return () => window.clearInterval(timer);
  }, [refresh, status.initialized, status.playing, status.transitionActive]);

  const loadTracks = useCallback(async (selected: NativeAudioTrack[]) => {
    setBusy(true);
    setError(null);
    try {
      const nextStatus = await loadAudioSong(selected);
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

  const loadPaths = useCallback(async (paths: string[]) => {
    const selected = paths
      .filter((path) => /\.(wav|wave|mp3|aif|aiff)$/i.test(path))
      .map((path, index) => audioTrackFromPath(path, index));
    return loadTracks(selected);
  }, [loadTracks]);

  const chooseAndLoad = useCallback(async () => {
    try {
      const selected = await chooseAudioTracks();
      if (selected.length === 0) return null;
      return await loadTracks(selected);
    } catch (cause) {
      setError(messageOf(cause));
      return null;
    }
  }, [loadTracks]);

  const chooseAndLoadVoicePack = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const directory = await chooseVoicePackDirectory();
      if (!directory) return null;

      const nextStatus = await loadVoicePack(directory);
      localStorage.setItem(VOICE_PACK_PATH_KEY, directory);
      setStatus(nextStatus);
      return nextStatus.voicePack ?? null;
    } catch (cause) {
      setError(messageOf(cause));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const updateGuideTimeline = useCallback(
    async (events: NativeGuideTimelineEvent[]) => {
      setError(null);
      try {
        setStatus(await setGuideTimeline(events));
      } catch (cause) {
        setError(messageOf(cause));
      }
    },
    []
  );

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
    pulsesPerBar: number;
    clickEnabled: boolean;
    keepAudio: boolean;
    guideEvents?: Array<{
      offsetPulses: number;
      token: string;
      gainDb?: number;
    }>;
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
    outputDevices,
    busy,
    error,
    hasLoadedAudio: (status.loadedTracks ?? 0) > 0,
    refresh,
    refreshOutputDevices,
    selectOutputDevice: async (name: string) => {
      if (busy || status.playing || status.transitionActive) return false;
      setBusy(true);
      setError(null);
      try {
        let next = await selectAudioOutputDevice(name);
        if (tracks.length > 0) {
          next = await loadAudioSong(tracks);
        }
        setStatus(next);
        await refreshOutputDevices();
        return true;
      } catch (cause) {
        setError(messageOf(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
    chooseAndLoad,
    loadTracks,
    loadPaths,
    chooseAndLoadVoicePack,
    updateGuideTimeline,
    playPause,
    stop,
    seek,
    scheduleTransition,
    cancelTransition,
    setBusGain: async (
      id: "music" | "click" | "guide" | "master",
      gainDb: number
    ) => {
      const next = await setNativeBusGain(id, gainDb);
      saveBusSetting(id, { gainDb });
      setStatus(next);
    },
    setBusMuted: async (
      id: "music" | "click" | "guide" | "master",
      muted: boolean
    ) => {
      const next = await setNativeBusMuted(id, muted);
      saveBusSetting(id, { muted });
      setStatus(next);
    },
    setBusRoute: async (
      id: "music" | "click" | "guide",
      outputLeft: number,
      outputRight: number
    ) => {
      const next = await setNativeBusRoute(id, outputLeft, outputRight);
      saveBusSetting(id, { outputLeft, outputRight });
      setStatus(next);
    },
    setTrackGain: setNativeTrackGain,
    setTrackMuted: setNativeTrackMuted,
    setTrackSolo: setNativeTrackSolo
  };
}

function readSavedBusSettings(): SavedBusSettings | null {
  const raw = localStorage.getItem(BUS_SETTINGS_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as SavedBusSettings;
  } catch {
    localStorage.removeItem(BUS_SETTINGS_KEY);
    return null;
  }
}

function saveBusSetting(id: AudioBusId, update: SavedBusSetting) {
  const current = readSavedBusSettings() ?? {};
  current[id] = {
    ...current[id],
    ...update
  };
  localStorage.setItem(BUS_SETTINGS_KEY, JSON.stringify(current));
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

export type AudioEngineController = ReturnType<typeof useAudioEngine>;
