import type { Setlist, Song, Track } from "./types";

const track = (
  id: string,
  name: string,
  kind: Track["kind"],
  color: string
): Track => ({
  id,
  name,
  kind,
  color,
  enabled: true,
  muted: false,
  solo: false,
  gainDb: 0
});

export const goodness: Song = {
  id: "goodness",
  title: "Goodness of God",
  artist: "Bethel Music",
  bpm: 63,
  key: "Ab",
  meter: [4, 4],
  durationSeconds: 318,
  downbeatSeconds: 0,
  status: "ready",
  countIn: { mode: "bars", value: 1 },
  manualJumpCountIn: { mode: "adaptive", minBeats: 2 },
  guideVoice: {
    voicePackId: "core-en-neutral-f",
    outputMode: "voice-and-click",
    sectionCues: "automatic",
    announceFirstSection: true,
    voiceFinalBarOnly: true,
    countFeel: "notated"
  },
  guideMarkers: [],
  tracks: [
    track("click", "Click", "click", "#cbd5e1"),
    track("guide", "Guide", "guide", "#60a5fa"),
    track("drums", "Drums", "drums", "#22d3ee"),
    track("bass", "Bass", "bass", "#34d399"),
    track("keys", "Keys", "keys", "#facc15"),
    track("guitar", "Guitar", "guitar", "#fb923c"),
    track("vocals", "Vocals", "vocals", "#f472b6"),
    track("other", "Other", "other", "#a78bfa"),
    track("midi", "MIDI", "midi", "#8b5cf6"),
    track("lighting", "Lighting", "lighting", "#f59e0b"),
    track("video", "Video", "video", "#38bdf8")
  ],
  sections: [
    { id: "intro", name: "Intro", startBar: 1, lengthBars: 8, color: "#34d399", lightingCue: "Intro Look" },
    { id: "verse1", name: "Verse 1", startBar: 9, lengthBars: 16, color: "#60a5fa", lightingCue: "Verse Wash" },
    { id: "chorus1", name: "Chorus 1", startBar: 25, lengthBars: 16, color: "#fb7185", lightingCue: "Chorus Wide", midiPatch: "12 Chorus" },
    { id: "verse2", name: "Verse 2", startBar: 41, lengthBars: 16, color: "#60a5fa" },
    { id: "chorus2", name: "Chorus 2", startBar: 57, lengthBars: 16, color: "#fb7185", lightingCue: "Chorus Wide", midiPatch: "12 Chorus", videoCue: "03" },
    { id: "bridge", name: "Bridge", startBar: 73, lengthBars: 32, color: "#a78bfa", lightingCue: "Bridge Atmos" },
    { id: "chorus3", name: "Chorus 3", startBar: 105, lengthBars: 16, color: "#fb7185" },
    { id: "outro", name: "Outro", startBar: 121, lengthBars: 8, color: "#34d399", followAction: "stop" }
  ]
};

const simpleSong = (
  id: string,
  title: string,
  artist: string,
  bpm: number,
  key: string,
  durationSeconds: number
): Song => ({
  ...goodness,
  id,
  title,
  artist,
  bpm,
  key,
  durationSeconds,
  tracks: goodness.tracks.map((item) => ({ ...item, id: id + "-" + item.id })),
  sections: goodness.sections.map((item) => ({ ...item, id: id + "-" + item.id }))
});

export const demoSetlist: Setlist = {
  id: "sunday-morning",
  name: "Sunday Morning",
  songs: [
    simpleSong("amazing", "This Is Amazing Grace", "Phil Wickham", 98, "G", 252),
    goodness,
    simpleSong("graves", "Graves Into Gardens", "Elevation Worship", 72, "C", 266),
    simpleSong("holy", "Holy Forever", "Chris Tomlin", 68, "Bb", 308),
    simpleSong("build", "Build My Life", "Housefires", 76, "C", 295),
    simpleSong("same", "Same God", "Elevation Worship", 70, "D", 258),
    simpleSong("king", "King of Kings", "Hillsong", 80, "Eb", 321),
    simpleSong("living", "Living Hope", "Phil Wickham", 72, "C", 254)
  ]
};
