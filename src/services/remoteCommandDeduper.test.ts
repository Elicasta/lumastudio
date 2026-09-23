import { describe, expect, it, vi } from "vitest";
import { RemoteCommandDeduper } from "./remoteCommandDeduper";
import type { RemoteCommandEnvelope } from "../remote/protocol";

const command = (id: string, payload?: Record<string, unknown>): RemoteCommandEnvelope => ({
  type: "command",
  id,
  command: "transport.go",
  payload
});

describe("RemoteCommandDeduper", () => {
  it("executes simultaneous duplicate commands only once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const handler = vi.fn(async (item: RemoteCommandEnvelope) => {
      await gate;
      return { id: item.id, ok: true };
    });
    const deduper = new RemoteCommandDeduper();

    const first = deduper.execute(command("go-1"), handler);
    const duplicate = deduper.execute(command("go-1"), handler);
    expect(handler).toHaveBeenCalledTimes(1);
    release();

    await expect(first).resolves.toEqual({ id: "go-1", ok: true });
    await expect(duplicate).resolves.toEqual({ id: "go-1", ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("replays the cached acknowledgement without reexecution", async () => {
    const handler = vi.fn(async (item: RemoteCommandEnvelope) => ({ id: item.id, ok: true }));
    const deduper = new RemoteCommandDeduper();
    await deduper.execute(command("go-2"), handler);
    await deduper.execute(command("go-2"), handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("rejects command id reuse with different content", async () => {
    const handler = vi.fn(async (item: RemoteCommandEnvelope) => ({ id: item.id, ok: true }));
    const deduper = new RemoteCommandDeduper();
    await deduper.execute(command("go-3", { value: 1 }), handler);
    await expect(deduper.execute(command("go-3", { value: 2 }), handler)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("reused")
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
