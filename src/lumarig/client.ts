import { commandEnvelope, LUMARIG_BRIDGE_PROTOCOL, type LumaRigCommand, type LumaRigCommandResult, type LumaRigPeer } from "./protocol";

export type LumaRigConnectionState = "disconnected" | "connecting" | "connected" | "degraded";

export class LumaRigClient {
  private socket: WebSocket | null = null;
  private generation = 0;
  private cancelConnect: (() => void) | null = null;
  private pending = new Map<string, { resolve: (result: LumaRigCommandResult) => void; timer: ReturnType<typeof setTimeout> }>();
  state: LumaRigConnectionState = "disconnected";
  peer: LumaRigPeer | null = null;
  lastError: string | null = null;
  lastMessageAt: number | null = null;
  latencyMs: number | null = null;

  async connect(peer: LumaRigPeer) {
    // Invalidate synchronously. Awaiting disconnect here lets concurrent connects
    // install two sockets before either has finished negotiating.
    void this.disconnect();
    const generation = this.generation;
    if (!peer.endpoint) throw new Error("LumaRig peer has no direct endpoint.");
    this.state = "connecting";
    this.lastError = null;
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(peer.endpoint);
      this.socket = socket;
      const current = () => this.generation === generation && this.socket === socket;
      const connectedSocket = socket;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (current()) this.cancelConnect = null;
          error ? reject(error) : resolve();
        };
        const timer = setTimeout(() => finish(new Error("LumaRig connection timed out.")), 5000);
        this.cancelConnect = () => finish(new Error("LumaRig connection cancelled."));
        connectedSocket.onopen = () => { if (current()) finish(); };
        connectedSocket.onerror = () => {
          if (!current()) return;
          finish(new Error("Could not connect to LumaRig."));
          this.lastError = "LumaRig socket error.";
          this.state = "degraded";
          this.rejectPending(this.lastError);
        };
        connectedSocket.onmessage = (event) => { if (current()) this.handleMessage(event.data); };
        connectedSocket.onclose = () => {
          if (!current()) return;
          finish(new Error("LumaRig disconnected during connection."));
          this.rejectPending("LumaRig disconnected.");
          this.socket = null; this.state = "disconnected"; this.peer = null;
        };
      });
      if (!current()) throw new Error("LumaRig connection superseded.");
      const started = Date.now();
      const hello = await this.send({ type: "hello", protocol: LUMARIG_BRIDGE_PROTOCOL, clientName: "LumaStudio" });
      if (!current()) throw new Error("LumaRig connection superseded.");
      if (!hello.ok) throw new Error(hello.error ?? "LumaRig rejected Studio.");
      const payload = hello.payload as { protocol?: number; app?: string } | undefined;
      if (payload?.protocol !== LUMARIG_BRIDGE_PROTOCOL || payload?.app !== "LumaRig") throw new Error("LumaRig handshake returned an incompatible identity or protocol.");
      this.latencyMs = Date.now() - started;
      this.state = "connected"; this.peer = peer;
    } catch (error) {
      if (this.generation === generation) {
        this.lastError = error instanceof Error ? error.message : String(error);
        void this.disconnect();
      } else { socket?.close(); }
      throw error;
    }
  }

  async disconnect() {
    ++this.generation;
    const cancel = this.cancelConnect;
    this.cancelConnect = null;
    cancel?.();
    this.rejectPending("LumaRig disconnected.");
    const socket = this.socket;
    this.socket = null; this.peer = null; this.state = "disconnected";
    this.latencyMs = null;
    socket?.close();
  }

  async send(command: LumaRigCommand): Promise<LumaRigCommandResult> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("LumaRig is not connected.");
    if (this.state === "connecting" && command.type !== "hello") throw new Error("LumaRig is still negotiating. Control is unavailable.");
    const envelope = commandEnvelope(command);
    if (this.pending.size >= 64) return { id: envelope.id, ok: false, error: "Too many pending LumaRig commands." };
    return new Promise((resolve) => {
      // Allow the native 3-second deadline to return its correlated response.
      const timer = setTimeout(() => {
        this.pending.delete(envelope.id);
        this.lastError = "LumaRig command timed out. Outcome unknown; inspect output before retrying.";
        this.state = "degraded";
        resolve({ id: envelope.id, ok: false, error: this.lastError });
      }, 4000);
      this.pending.set(envelope.id, { resolve, timer });
      try { socket.send(JSON.stringify(envelope)); }
      catch (error) {
        clearTimeout(timer); this.pending.delete(envelope.id);
        this.lastError = String(error); this.state = "degraded";
        resolve({ id: envelope.id, ok: false, error: this.lastError });
      }
    });
  }

  private handleMessage(raw: unknown) {
    try {
      const result: unknown = JSON.parse(String(raw));
      if (!result || typeof result !== "object" || typeof (result as LumaRigCommandResult).id !== "string" || typeof (result as LumaRigCommandResult).ok !== "boolean") throw new Error("Invalid response envelope.");
      const response = result as LumaRigCommandResult;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(response.id);
      this.lastMessageAt = Date.now();
      pending.resolve(response);
    } catch {
      this.lastError = "Invalid response from LumaRig.";
      this.state = "degraded";
    }
  }
  private rejectPending(error: string) {
    for (const [id, pending] of this.pending) { clearTimeout(pending.timer); pending.resolve({ id, ok: false, error }); }
    this.pending.clear();
  }
}
