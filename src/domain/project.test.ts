import { describe, expect, it } from "vitest";
import { createProject, parseProject, serializeProject } from "./project";
import { createServiceSong } from "./service";

describe("project files", () => {
  it("round trips an empty service without inventing a song", () => {
    const parsed = parseProject(serializeProject(createProject("Sunday")));
    expect(parsed.setlist.songs).toEqual([]);
    expect(parsed.selectedSongId).toBeUndefined();
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
