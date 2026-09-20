import { describe, expect, it } from "vitest";
import {
  isRemoteCommand,
  isRemoteCommandEnvelope,
  REMOTE_COMMANDS
} from "./protocol";

describe("Studio remote protocol", () => {
  it("keeps the remote command surface explicit", () => {
    expect(REMOTE_COMMANDS).toContain("transport.go");
    expect(REMOTE_COMMANDS).toContain("song.next");
    expect(REMOTE_COMMANDS).toContain("mixer.gain");
  });

  it("rejects commands Studio does not implement", () => {
    expect(isRemoteCommand("transport.play")).toBe(true);
    expect(isRemoteCommand("transport.explode")).toBe(false);
    expect(
      isRemoteCommandEnvelope({
        type: "command",
        id: "cmd-1",
        command: "transport.explode"
      })
    ).toBe(false);
  });

  it("accepts a valid command envelope", () => {
    expect(
      isRemoteCommandEnvelope({
        type: "command",
        id: "cmd-2",
        command: "song.next"
      })
    ).toBe(true);
  });
});
