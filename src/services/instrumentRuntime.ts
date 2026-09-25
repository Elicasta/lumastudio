import { buildInstrumentTimeline } from "../domain/instrumentTimeline";
import type { Song, Track } from "../domain/types";
import {
  clearInstrumentTimeline,
  loadAudioUnitInstrument,
  saveAudioUnitState,
  scanAudioUnits,
  setInstrumentTimeline,
  unloadAudioUnitInstrument,
  type AudioUnitPluginInfo
} from "./plugins";

export function songSoftwareInstrumentTrack(song: Song): Track | undefined {
  return song.tracks.find(
    (track) =>
      track.sourceType === "instrument" &&
      track.instrument?.mode === "plugin"
  );
}

export async function activateSongInstrument(song: Song): Promise<{
  track?: Track;
  plugin?: AudioUnitPluginInfo;
  warning?: string;
}> {
  const track = songSoftwareInstrumentTrack(song);

  if (!track || track.instrument?.mode !== "plugin") {
    try {
      await clearInstrumentTimeline();
      await unloadAudioUnitInstrument();
    } catch {
      // The audio engine may not have been initialized yet.
    }
    return {};
  }

  const assigned = track.instrument.plugin;
  const installed = await scanAudioUnits();
  const plugin = installed.find(
    (candidate) =>
      candidate.category === "instrument" &&
      candidate.identifier === assigned.plugin.identifier
  );

  if (!plugin) {
    try {
      await clearInstrumentTimeline();
      await unloadAudioUnitInstrument();
    } catch {
      // Keep project selection usable even when a plug-in is missing.
    }
    return {
      track,
      warning:
        assigned.plugin.name +
        " is assigned to " +
        track.name +
        " but is not registered on this Mac."
    };
  }

  await loadAudioUnitInstrument(plugin, assigned.state);
  const timeline = buildInstrumentTimeline(song, track);
  await setInstrumentTimeline(timeline.events, timeline.durationSeconds);

  const instrumentTracks = song.tracks.filter(
    (candidate) =>
      candidate.sourceType === "instrument" &&
      candidate.instrument?.mode === "plugin"
  );

  return {
    track,
    plugin,
    warning:
      instrumentTracks.length > 1
        ? "This host slice plays one software-instrument track at a time. " +
          track.name +
          " is active; multi-instrument rack playback is next."
        : undefined
  };
}

export async function syncActiveInstrumentTimeline(
  song: Song,
  activePluginIdentifier?: string | null
): Promise<boolean> {
  if (!activePluginIdentifier) return false;

  const track = song.tracks.find(
    (candidate) =>
      candidate.sourceType === "instrument" &&
      candidate.instrument?.mode === "plugin" &&
      candidate.instrument.plugin.plugin.identifier === activePluginIdentifier
  );
  if (!track) return false;

  const timeline = buildInstrumentTimeline(song, track);
  await setInstrumentTimeline(timeline.events, timeline.durationSeconds);
  return true;
}

export async function captureActiveInstrumentState(
  song: Song,
  activePluginIdentifier?: string | null
): Promise<Song> {
  if (!activePluginIdentifier) return song;

  const track = song.tracks.find(
    (candidate) =>
      candidate.sourceType === "instrument" &&
      candidate.instrument?.mode === "plugin" &&
      candidate.instrument.plugin.plugin.identifier === activePluginIdentifier
  );
  if (!track) return song;

  let state: string;
  try {
    state = await saveAudioUnitState();
  } catch {
    return song;
  }

  return {
    ...song,
    tracks: song.tracks.map((candidate) => {
      if (
        candidate.id !== track.id ||
        candidate.instrument?.mode !== "plugin"
      ) {
        return candidate;
      }

      return {
        ...candidate,
        instrument: {
          ...candidate.instrument,
          plugin: {
            ...candidate.instrument.plugin,
            state
          }
        }
      };
    })
  };
}
