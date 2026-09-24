import { describe, expect, it } from "vitest";
import { createProject, parseProject, serializeProject } from "./project";
import { createServiceSong } from "./service";

describe("project files", () => {
  it("round trips an empty service without inventing a song", () => {
    const parsed = parseProject(serializeProject(createProject("Sunday")));
    expect(parsed.setlist.songs).toEqual([]);
    expect(parsed.selectedSongId).toBeUndefined();
  });
  it("rejects duplicate or malformed persisted pad banks", () => {
    const project = createProject("Sunday");
    project.pads = [{
      id: "pad-1",
      name: "Atmosphere",
      mode: "latch",
      gainDb: 0,
      octave: 0,
      width: 70,
      attackMs: 10,
      releaseMs: 1000
    }, {
      id: "pad-1",
      name: "Duplicate",
      mode: "hold",
      gainDb: 0,
      octave: 0,
      width: 70,
      attackMs: 10,
      releaseMs: 1000
    }];
    expect(() => parseProject(JSON.stringify(project))).toThrow("pad");

    project.pads = [{
      id: "pad-2",
      name: "Unsafe",
      mode: "latch",
      gainDb: 0,
      octave: 0,
      width: 140,
      attackMs: 10,
      releaseMs: 1000
    }];
    expect(() => parseProject(JSON.stringify(project))).toThrow("pad");
  });

  it("rejects duplicate items and malformed collections before replacing the active show", () => {
    const project = createProject("Sunday", [createServiceSong("Opening")]);
    project.setlist.songs.push(project.setlist.songs[0]);
    expect(() => parseProject(JSON.stringify(project))).toThrow("duplicated");
    project.setlist.songs.pop();
    (project.setlist as unknown as { songs: unknown }).songs = null;
    expect(() => parseProject(JSON.stringify(project))).toThrow("running order");
  });
});
