import { useCallback, useEffect, useRef, useState } from "react";
import { loopbackLumaRigPeer } from "../lumarig/discovery";
import { LumaRigClient, type LumaRigConnectionState } from "../lumarig/client";
import type { LumaRigCommand, LumaRigPeer, LumaRigSongIdentity } from "../lumarig/protocol";

export function useLumaRig() {
  const clientRef = useRef<LumaRigClient | null>(null);
  if (!clientRef.current) clientRef.current = new LumaRigClient();
  const [state, setState] = useState<LumaRigConnectionState>("disconnected");
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [peer, setPeer] = useState<LumaRigPeer | null>(null);
  const [error, setError] = useState("");

  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);
  const operation = useRef(0);
  const autoConnectAllowed = useRef(true);
  const refresh = useCallback(() => {
    setState(clientRef.current!.state);
    setPeer(clientRef.current!.peer);
    setLatencyMs(clientRef.current!.latencyMs);
    setLastMessageAt(clientRef.current!.lastMessageAt);
    if (clientRef.current!.lastError) setError(clientRef.current!.lastError);
  }, []);

  const connect = useCallback(async (target: LumaRigPeer) => {
    autoConnectAllowed.current = true;
    const currentOperation = ++operation.current;
    setError("");
    setState("connecting");
    try {
      await clientRef.current!.connect(target);
      setConnectionEpoch((value) => value + 1);
      refresh();
    } catch (cause) {
      if (operation.current === currentOperation) { setError(cause instanceof Error ? cause.message : String(cause)); refresh(); }
      throw cause;
    }
  }, [refresh]);

  const disconnect = useCallback(async () => {
    autoConnectAllowed.current = false;
    ++operation.current;
    await clientRef.current!.disconnect();
    refresh();
  }, [refresh]);

  const send = useCallback(async (command: LumaRigCommand) => {
    const result = await clientRef.current!.send(command);
    refresh();
    if (!result.ok) setError(result.error ?? "LumaRig command failed.");
    return result;
  }, [refresh]);

  const resolveSong = useCallback(async (identity: LumaRigSongIdentity, createIfMissing = true) =>
    send({ type: "song.resolve", ...identity, createIfMissing }), [send]);

  // Probe the loopback peer with backoff. A missing Rig is a normal independent-app state.
  useEffect(() => {
    let disposed = false;
    let delay = 2000;
    let retry: number;
    const probe = async () => {
      const client = clientRef.current!;
      if (!disposed && autoConnectAllowed.current && client.state === "disconnected") {
        try { await client.connect(loopbackLumaRigPeer()); delay = 2000; setConnectionEpoch((value) => value + 1); refresh(); }
        catch (cause) {
          if (disposed) return;
          const message = cause instanceof Error ? cause.message : String(cause);
          if (/incompatible|rejected|protocol/i.test(message)) setError(message);
          else { client.lastError = null; setError(""); }
          delay = Math.min(30000, Math.round(delay * 1.8));
          refresh();
        }
      }
      if (!disposed) retry = window.setTimeout(probe, delay);
    };
    retry = window.setTimeout(probe, 500);
    const status = window.setInterval(refresh, 250);
    return () => { disposed = true; window.clearTimeout(retry); window.clearInterval(status); void clientRef.current?.disconnect(); };
  }, [refresh]);

  return { state, connectionEpoch, peer, error, latencyMs, lastMessageAt, connect, disconnect, send, resolveSong };
}
