import type { RealtimeChannel } from "@supabase/supabase-js";
import type {
  RemoteCommandAck,
  RemoteCommandEnvelope,
  RemoteStudioState
} from "../remote/protocol";
import { isRemoteCommandEnvelope } from "../remote/protocol";
import { supabase } from "./supabase";

export type RemoteRelayStatus =
  | "idle"
  | "creating"
  | "connecting"
  | "online"
  | "error";

export interface RemoteSessionInfo {
  sessionId: string;
  pairCode: string;
  topic: string;
  studioToken: string;
  pairExpiresAt: string;
  expiresAt: string;
}

export interface RemoteRelayEvents {
  onStatus: (status: RemoteRelayStatus) => void;
  onSession: (session: RemoteSessionInfo | null) => void;
  onCommand: (command: RemoteCommandEnvelope) => Promise<RemoteCommandAck>;
  onError: (message: string | null) => void;
}

const SESSION_FUNCTION = "lumarig-remote-session";

export class RemoteRelay {
  private channel: RealtimeChannel | null = null;
  private session: RemoteSessionInfo | null = null;
  private heartbeatTimer: number | null = null;
  private publishTimer: number | null = null;
  private pendingState: RemoteStudioState | null = null;
  private revision = 0;
  private closed = false;
  private online = false;

  constructor(
    private readonly studioId: string,
    private readonly events: RemoteRelayEvents
  ) {}

  async start() {
    this.closed = false;
    this.events.onStatus("creating");
    this.events.onError(null);

    try {
      const session = await this.createSession();
      if (this.closed) return;

      this.session = session;
      this.events.onSession(session);
      await this.connectChannel(session.topic);

      if (this.closed) return;
      this.startHeartbeat();
    } catch (cause) {
      this.fail(cause);
    }
  }

  queueState(state: RemoteStudioState) {
    this.pendingState = {
      ...state,
      revision: ++this.revision
    };

    if (this.publishTimer !== null) return;

    this.publishTimer = window.setTimeout(() => {
      this.publishTimer = null;
      void this.flushState();
    }, 100);
  }

  async rotatePairCode() {
    const session = this.session;
    if (!session) {
      await this.start();
      return;
    }

    try {
      const rotated = await invokeSessionFunction<RemoteSessionInfo>({
        action: "rotate",
        sessionId: session.sessionId,
        studioToken: session.studioToken
      });

      this.session = rotated;
      this.events.onSession(rotated);
      this.events.onError(null);
    } catch (cause) {
      this.fail(cause);
    }
  }

  async restart() {
    await this.stop(false);
    await this.start();
  }

  async stop(closeRemoteSession = true) {
    this.closed = true;

    if (this.publishTimer !== null) {
      window.clearTimeout(this.publishTimer);
      this.publishTimer = null;
    }

    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.online = false;

    const channel = this.channel;
    this.channel = null;
    if (channel) {
      await supabase.removeChannel(channel);
    }

    const session = this.session;
    this.session = null;
    this.events.onSession(null);
    this.events.onStatus("idle");

    if (closeRemoteSession && session) {
      await invokeSessionFunction({
        action: "close",
        sessionId: session.sessionId,
        studioToken: session.studioToken
      }).catch(() => undefined);
    }
  }

  private async createSession(): Promise<RemoteSessionInfo> {
    return invokeSessionFunction<RemoteSessionInfo>({
      action: "create",
      studioId: this.studioId,
      studioName: "LumaRig Studio"
    });
  }

  private async connectChannel(topic: string) {
    this.events.onStatus("connecting");

    const channel = supabase
      .channel(topic, {
        config: {
          broadcast: {
            self: false,
            ack: true
          }
        }
      })
      .on("broadcast", { event: "remote_command" }, async ({ payload }) => {
        if (!isRemoteCommandEnvelope(payload)) return;

        try {
          const ack = await this.events.onCommand(payload);
          await channel.send({
            type: "broadcast",
            event: "command_ack",
            payload: ack
          });
        } catch (cause) {
          const ack: RemoteCommandAck = {
            id: payload.id,
            ok: false,
            error: messageOf(cause)
          };
          await channel.send({
            type: "broadcast",
            event: "command_ack",
            payload: ack
          });
        }
      })
      .on("broadcast", { event: "remote_hello" }, () => {
        void this.flushState(true);
      });

    this.channel = channel;

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      channel.subscribe((status, error) => {
        if (status === "SUBSCRIBED") {
          settled = true;
          this.online = true;
          this.events.onStatus("online");
          void this.flushState(true);
          resolve();
          return;
        }

        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          this.online = false;
        }

        if (
          !settled &&
          (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
        ) {
          reject(error ?? new Error("Remote relay could not connect."));
        }
      });
    });
  }

  private async flushState(force = false) {
    if (!this.channel || !this.pendingState) return;
    if (!force && this.eventsStatusOffline()) return;

    const state = this.pendingState;
    const response = await this.channel.send({
      type: "broadcast",
      event: "studio_state",
      payload: state
    });

    if (response !== "ok") {
      this.events.onError("Remote state broadcast failed.");
    } else {
      this.events.onError(null);
    }
  }

  private eventsStatusOffline() {
    return this.closed || !this.channel || !this.online;
  }

  private startHeartbeat() {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = window.setInterval(() => {
      const session = this.session;
      if (!session) return;

      void invokeSessionFunction({
        action: "heartbeat",
        sessionId: session.sessionId,
        studioToken: session.studioToken
      }).catch((cause) => {
        this.events.onError(messageOf(cause));
      });
    }, 30_000);
  }

  private fail(cause: unknown) {
    this.events.onStatus("error");
    this.events.onError(messageOf(cause));
  }
}

export function getStudioInstanceId() {
  const key = "lumarig.studio.instance-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

async function invokeSessionFunction<T = { ok: true }>(
  body: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(SESSION_FUNCTION, {
    body
  });

  if (error) {
    throw new Error(error.message);
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  return data as T;
}

function messageOf(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
