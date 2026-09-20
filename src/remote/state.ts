import { musicalPositionAtSeconds } from "../domain/timing";
import type { Setlist, Song } from "../domain/types";
import type { NativeAudioStatus } from "../services/audio";
import { REMOTE_PROTOCOL_VERSION, type RemoteStudioState } from "./protocol";

const padNames = [
  "Warmth",
  "Air",
  "Deep",
  "Shimmer",
  "Bloom",
  "Motion",
  "Glass",
  "Soft",
  "Wide",
  "Choir",
  "Atmos",
  "Ritual"
];

const padColors = [
  "#fbbf24",
  "#60a5fa",
  "#f472b6",
  "#2dd4bf",
  "#34d399",
  "#8b5cf6",
  "#f59e0b",
  "#38bdf8",
  "#fb7185",
  "#22d3ee",
  "#a78bfa",
  "#fb923c"
];

export function buildRemoteStudioState({
  setlist,
  song,
  currentSectionIndex,
  previewPlaying,
  audioStatus,
  queuedSectionIndex = null
}: {
  setlist: Setlist;
  song: Song;
  currentSectionIndex: number;
  previewPlaying: boolean;
  audioStatus: NativeAudioStatus;
  queuedSectionIndex?: number | null;
}): RemoteStudioState {
  const safeSectionIndex = clampSectionIndex(song, currentSectionIndex);
  const currentSection = song.sections[safeSectionIndex];
  const hasNativeAudio = (audioStatus.loadedTracks ?? 0) > 0;
  const playing = hasNativeAudio ? Boolean(audioStatus.playing) : previewPlaying;
  const durationSeconds =
    hasNativeAudio && audioStatus.durationSeconds
      ? audioStatus.durationSeconds
      : song.durationSeconds;
  const positionSeconds = hasNativeAudio
    ? audioStatus.positionSeconds ?? 0
    : 0;

  const musicalPosition = musicalPositionAtSeconds(song, positionSeconds);

  const audioTracks = song.tracks.filter(
    (track) => !["midi", "lighting", "video"].includes(track.kind)
  );

  return {
    protocolVersion: REMOTE_PROTOCOL_VERSION,
    revision: 0,
    setlist: {
      id: setlist.id,
      name: setlist.name,
      songs: setlist.songs.map((item) => ({
        id: item.id,
        title: item.title,
        artist: item.artist,
        bpm: item.bpm,
        key: item.key,
        meter: item.meter,
        durationSeconds: item.durationSeconds,
        status: item.status,
        countIn: item.countIn,
        current: item.id === song.id
      }))
    },
    song: {
      id: song.id,
      title: song.title,
      artist: song.artist,
      bpm: song.bpm,
      key: song.key,
      meter: song.meter
    },
    sections: song.sections.map((section) => ({
      id: section.id,
      name: section.name,
      startBar: section.startBar,
      lengthBars: section.lengthBars
    })),
    currentSectionIndex: safeSectionIndex,
    queuedSectionIndex:
      queuedSectionIndex ??
      (safeSectionIndex < song.sections.length - 1 ? safeSectionIndex + 1 : null),
    transport: {
      playing,
      positionSeconds,
      durationSeconds,
      bar: musicalPosition.bar,
      beat: musicalPosition.beat,
      countInActive: Boolean(audioStatus.countInActive),
      countInBeat: audioStatus.countInBeat ?? 0,
      countInTotal: audioStatus.countInTotal ?? 0,
      queuedSectionId:
        queuedSectionIndex !== null
          ? song.sections[queuedSectionIndex]?.id ?? null
          : null
    },
    pads: padNames.map((name, index) => ({
      id: "pad-" + (index + 1),
      name,
      active: false,
      color: padColors[index]
    })),
    mixer: audioTracks.map((track, index) => ({
      id: track.id,
      name: track.name,
      gainDb: track.gainDb,
      muted: track.muted,
      solo: track.solo,
      meter: meterFor(index, audioStatus),
      color: track.color
    })),
    lighting: {
      blackout: false,
      x: 0.5,
      y: 0.5,
      scenes: [
        { id: "clean", name: "Clean", color: "#60a5fa", active: false },
        { id: "verse", name: "Verse", color: "#34d399", active: false },
        { id: "chorus", name: "Chorus", color: "#f472b6", active: false },
        { id: "bridge", name: "Bridge", color: "#a78bfa", active: false }
      ]
    },
    health: {
      audio: Boolean(audioStatus.initialized) && !audioStatus.deviceError,
      midi: false,
      lighting: false,
      remote: true
    }
  };
}

function clampSectionIndex(song: Song, index: number) {
  if (song.sections.length === 0) return 0;
  return Math.max(0, Math.min(song.sections.length - 1, index));
}

function meterFor(index: number, status: NativeAudioStatus) {
  if (index === 0) return status.peakLeft ?? 0;
  if (index === 1) return status.peakRight ?? 0;
  return 0;
}
