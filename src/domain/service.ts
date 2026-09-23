import type { Section, Song } from "./types";

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

/** Keep the show timeline contiguous when an operator edits section lengths. */
export function reflowSongSections(song: Song, sections: Section[]): Song {
  if (!sections.length || sections.length > 128 || sections.some(section => !Number.isInteger(section.lengthBars) || section.lengthBars < 1 || section.lengthBars > 512))
    throw new Error("A song needs 1 to 128 sections, each 1 to 512 bars long.");
  const ids = new Set(sections.map(section => section.id));
  if (ids.size !== sections.length) throw new Error("Section identities must be unique.");
  let bar = 1;
  const next = sections.map(section => {
    const updated = { ...section, startBar: bar };
    bar += section.lengthBars;
    return updated;
  });
  const guideMarkers = song.guideMarkers.flatMap(marker => {
    const owner = song.sections.find((section, index) => marker.bar >= section.startBar
      && marker.bar < (song.sections[index + 1]?.startBar ?? Infinity));
    if (!owner || !ids.has(owner.id)) return [];
    const target = next.find(section => section.id === owner.id)!;
    return [{ ...marker, bar: target.startBar + Math.min(marker.bar - owner.startBar, target.lengthBars - 1) }];
  });
  return { ...song, sections: next, guideMarkers };
}

export function moveServiceItem(songs: Song[], id: string, direction: -1 | 1): Song[] {
  const index = songs.findIndex(song => song.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= songs.length) return songs;
  const result = [...songs];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}
