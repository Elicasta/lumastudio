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

  it("serializes distinct commands in arrival order", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const deduper = new RemoteCommandDeduper();

    const first = deduper.execute(command("go-a"), async (item) => {
      events.push("start-" + item.id);
      await firstGate;
      events.push("end-" + item.id);
      return { id: item.id, ok: true };
    });
    const second = deduper.execute(command("go-b"), async (item) => {
      events.push("start-" + item.id);
      events.push("end-" + item.id);
      return { id: item.id, ok: true };
    });

    await Promise.resolve();
    expect(events).toEqual(["start-go-a"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["start-go-a", "end-go-a", "start-go-b", "end-go-b"]);
  });

  it("cancels queued commands when the remote session changes", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const handler = vi.fn(async (item: RemoteCommandEnvelope) => {
      if (item.id === "first") await firstGate;
      return { id: item.id, ok: true };
    });
    const deduper = new RemoteCommandDeduper();

    const first = deduper.execute(command("first"), handler);
    const queued = deduper.execute(command("queued"), handler);
    await Promise.resolve();
    deduper.clear();
    releaseFirst();

    await first;
    await expect(queued).resolves.toMatchObject({ ok: false, error: expect.stringContaining("session changed") });
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
