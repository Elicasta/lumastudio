import type { Song } from "./types";

/** A new item contains no imaginary media, cues or imported metadata. */
export function createServiceSong(title: string): Song {
  const name = title.trim();
  if (!name) throw new Error("Enter a title for the service item.");
  return {
    id: crypto.randomUUID(), title: name, artist: "", bpm: 120, key: "C",
    meter: [4, 4], durationSeconds: 0, status: "needs-review",
    countIn: { mode: "none" }, manualJumpCountIn: { mode: "adaptive", minBeats: 2 },
    guideVoice: {
      voicePackId: "core-en-neutral-f", outputMode: "off", sectionCues: "off",
      announceFirstSection: false, voiceFinalBarOnly: true, countFeel: "notated"
    },
    guideMarkers: [], tracks: [], sections: [{
      id: crypto.randomUUID(), name: "Intro", startBar: 1, lengthBars: 8,
      color: "#60a5fa"
    }]
  };
}

/** Resolve the selected item without assuming that an empty show contains one. */
export function selectedServiceSong(songs: Song[], id?: string): Song | undefined {
  return songs.find(song => song.id === id) ?? songs[0];
}
