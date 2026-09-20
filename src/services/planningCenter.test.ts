import { describe, expect, it } from "vitest";
import { mapPlanningCenterPlan } from "./planningCenter";
import type { Song } from "../domain/types";

const existing: Song = {
  id: "local-holy",
  title: "Holy Forever",
  artist: "Local",
  bpm: 68,
  key: "Bb",
  meter: [4, 4],
  durationSeconds: 300,
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
    { id: "drums", name: "Drums", kind: "drums", color: "#fff", enabled: true, muted: false, solo: false, gainDb: 0 }
  ],
  sections: [
    { id: "real-verse", name: "Verse 1", startBar: 1, lengthBars: 16, color: "#fff" }
  ]
};

const raw = {
  plan: {
    data: {
      id: "plan-1",
      type: "Plan",
      attributes: {
        title: "Sunday Morning",
        dates: "September 27",
        sort_date: "2026-09-27T10:00:00-04:00"
      }
    }
  },
  items: {
    data: [
      {
        id: "item-1",
        type: "Item",
        attributes: {
          title: "Holy Forever",
          item_type: "song",
          key_name: "D",
          length: 305,
          sequence: 1,
          custom_arrangement_sequence: ["Verse 1", "Chorus", "Bridge", "Chorus"]
        },
        relationships: {
          song: { data: { id: "song-1", type: "Song" } },
          arrangement: { data: { id: "arr-1", type: "Arrangement" } }
        }
      },
      {
        id: "item-2",
        type: "Item",
        attributes: {
          title: "Offering",
          item_type: "item",
          sequence: 2
        },
        relationships: {}
      }
    ],
    included: [
      {
        id: "song-1",
        type: "Song",
        attributes: { title: "Holy Forever", author: "Chris Tomlin" }
      },
      {
        id: "arr-1",
        type: "Arrangement",
        attributes: { bpm: 72, meter: "4/4", sequence: ["Verse 1", "Chorus", "Bridge"] }
      }
    ]
  }
};

describe("Planning Center service import", () => {
  it("keeps existing Studio audio and section timing when matching a song", () => {
    const result = mapPlanningCenterPlan(
      raw,
      { id: "service-1", name: "Sunday AM" },
      [existing],
      false
    );

    const song = result.songs[0];
    expect(song.id).toBe("local-holy");
    expect(song.tracks).toHaveLength(1);
    expect(song.sections[0].id).toBe("real-verse");
    expect(song.bpm).toBe(68);
    expect(song.key).toBe("D");
    expect(song.external?.planningCenterSongId).toBe("song-1");
    expect(song.external?.planningCenterSequence).toEqual(["Verse 1", "Chorus", "Bridge", "Chorus"]);
    expect(result.link.items).toHaveLength(2);
  });

  it("creates a needs-review placeholder for a new Planning Center song", () => {
    const result = mapPlanningCenterPlan(
      raw,
      { id: "service-1", name: "Sunday AM" },
      [],
      false
    );

    expect(result.songs[0].status).toBe("needs-review");
    expect(result.songs[0].bpm).toBe(72);
    expect(result.songs[0].sections.map((section) => section.name)).toEqual([
      "Verse 1",
      "Chorus",
      "Bridge",
      "Chorus"
    ]);
  });
});
