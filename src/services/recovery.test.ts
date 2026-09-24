import { describe, expect, it } from "vitest";
import { createProject } from "../domain/project";
import { createServiceSong } from "../domain/service";
import { clearRecovery, readRecovery, writeRecovery } from "./recovery";

describe("service recovery", () => {
  it("restores the last prepared running order and ignores a malformed snapshot", () => {
    const map = new Map<string,string>();
    const storage = {
      getItem: (key:string) => map.get(key) ?? null,
      setItem: (key:string, value:string) => {map.set(key,value);},
      removeItem: (key:string) => {map.delete(key);}
    };
    const project = createProject("Sunday", [createServiceSong("Opening")]);
    writeRecovery(storage, project, "2026-09-23T00:00:00Z");
    expect(readRecovery(storage)?.project.setlist.songs[0].title).toBe("Opening");
    storage.setItem("lumastudio.recovery.v1", "{bad");
    expect(readRecovery(storage)).toBeNull();
    clearRecovery(storage);
    expect(map.size).toBe(0);
    writeRecovery(storage, createProject("New Service"));
    expect(readRecovery(storage)).toBeNull();
  });
});
