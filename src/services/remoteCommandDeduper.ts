import type { RemoteCommandAck, RemoteCommandEnvelope } from "../remote/protocol";

const MAX_CACHED_COMMANDS = 256;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableValue(item)])
  );
}

function fingerprint(command: RemoteCommandEnvelope) {
  return JSON.stringify(stableValue({ command: command.command, payload: command.payload ?? null }));
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

export class RemoteCommandDeduper {
  private readonly entries = new Map<string, { fingerprint: string; result: Promise<RemoteCommandAck> }>();
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;

  execute(
    command: RemoteCommandEnvelope,
    handler: (command: RemoteCommandEnvelope) => Promise<RemoteCommandAck>
  ): Promise<RemoteCommandAck> {
    const key = command.id;
    const nextFingerprint = fingerprint(command);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.fingerprint !== nextFingerprint) {
        return Promise.resolve({
          id: key,
          ok: false,
          error: "Command ID was reused with different content."
        });
      }
      return existing.result;
    }

    const generation = this.generation;
    const result = this.tail
      .then(() => {
        if (generation !== this.generation) {
          return {
            id: key,
            ok: false,
            error: "Remote session changed before the command could execute."
          } satisfies RemoteCommandAck;
        }
        return handler(command);
      })
      .catch((cause): RemoteCommandAck => ({
        id: key,
        ok: false,
        error: errorMessage(cause)
      }));
    this.tail = result.then(() => undefined, () => undefined);

    this.entries.set(key, { fingerprint: nextFingerprint, result });
    while (this.entries.size > MAX_CACHED_COMMANDS) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
    return result;
  }

  clear() {
    this.generation += 1;
    this.entries.clear();
    this.tail = Promise.resolve();
  }
}
