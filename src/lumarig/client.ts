import { commandEnvelope, LUMARIG_BRIDGE_PROTOCOL, type LumaRigCommand, type LumaRigCommandResult, type LumaRigPeer } from "./protocol";

export type LumaRigConnectionState = "disconnected" | "connecting" | "connected" | "degraded";

export class LumaRigClient {
  private socket: WebSocket | null = null;
  private pending = new Map<string, { resolve: (result: LumaRigCommandResult) => void; timer: number }>();
  state: LumaRigConnectionState = "disconnected";
  peer: LumaRigPeer | null = null;

  async connect(peer: LumaRigPeer) {
    await this.disconnect();
    if (!peer.endpoint) throw new Error("LumaRig peer has no direct endpoint.");
    this.state = "connecting";
    const socket = new WebSocket(peer.endpoint);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("LumaRig connection timed out.")), 5000);
      socket.onopen = () => { window.clearTimeout(timer); resolve(); };
      socket.onerror = () => { window.clearTimeout(timer); reject(new Error("Could not connect to LumaRig.")); };
    });
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onclose = () => { this.rejectPending("LumaRig disconnected."); this.state = "disconnected"; this.peer = null; };
    this.state = "connected";
    this.peer = peer;
    const hello = await this.send({ type: "hello", protocol: LUMARIG_BRIDGE_PROTOCOL, clientName: "LumaRig Studio" });
    if (!hello.ok) { await this.disconnect(); throw new Error(hello.error ?? "LumaRig rejected Studio."); }
  }

  async disconnect() {
    this.rejectPending("LumaRig disconnected.");
    this.socket?.close();
    this.socket = null;
    this.peer = null;
    this.state = "disconnected";
  }

  async send(command: LumaRigCommand): Promise<LumaRigCommandResult> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("LumaRig is not connected.");
    const envelope = commandEnvelope(command);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(envelope.id);
        resolve({ id: envelope.id, ok: false, error: "LumaRig command timed out." });
      }, 3000);
      this.pending.set(envelope.id, { resolve, timer });
      this.socket!.send(JSON.stringify(envelope));
    });
  }

  private handleMessage(raw: unknown) {
    try {
      const result = JSON.parse(String(raw)) as LumaRigCommandResult;
      const pending = this.pending.get(result.id);
      if (!pending) return;
      window.clearTimeout(pending.timer);
      this.pending.delete(result.id);
      pending.resolve(result);
    } catch {
      this.state = "degraded";
    }
  }
  private rejectPending(error: string) {
    for (const [id, pending] of this.pending) {
      window.clearTimeout(pending.timer);
      pending.resolve({ id, ok: false, error });
    }
    this.pending.clear();
  }

}
