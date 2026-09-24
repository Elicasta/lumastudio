import { describe, expect, it } from "vitest";
import { RemoteTransitionGate } from "./remoteTransitionGate";

describe("RemoteTransitionGate", () => {
  it("allows one transition and rejects overlap until released", () => {
    const gate = new RemoteTransitionGate();
    expect(gate.tryBegin()).toBe(true);
    expect(gate.busy).toBe(true);
    expect(gate.tryBegin()).toBe(false);
    gate.release();
    expect(gate.tryBegin()).toBe(true);
  });

  it("release is idempotent for STOP and PAUSE cancellation paths", () => {
    const gate = new RemoteTransitionGate();
    gate.release();
    expect(gate.busy).toBe(false);
    gate.tryBegin();
    gate.release();
    gate.release();
    expect(gate.busy).toBe(false);
  });
});
