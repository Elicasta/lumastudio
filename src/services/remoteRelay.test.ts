import { describe, expect, it } from "vitest";
import { countRemoteClients } from "./remoteRelay";

describe("countRemoteClients", () => {
  it("counts each remote presence key once", () => {
    expect(
      countRemoteClients({
        "studio-1": [{ type: "studio" }],
        "remote-a": [{ type: "remote", clientName: "iPad" }],
        "remote-b": [
          { type: "remote", clientName: "iPhone" },
          { type: "remote", clientName: "iPhone duplicate presence" }
        ]
      })
    ).toBe(2);
  });

  it("ignores Studio and unknown presence records", () => {
    expect(
      countRemoteClients({
        studio: [{ type: "studio" }],
        other: [{ type: "observer" }]
      })
    ).toBe(0);
  });
});
