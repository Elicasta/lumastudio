import { useCallback, useEffect, useRef, useState } from "react";
import { LumaRigClient, type LumaRigConnectionState } from "../lumarig/client";
import type { LumaRigCommand, LumaRigPeer, LumaRigSongIdentity } from "../lumarig/protocol";

export function useLumaRig() {
  const clientRef = useRef<LumaRigClient | null>(null);
  if (!clientRef.current) clientRef.current = new LumaRigClient();
  const [state, setState] = useState<LumaRigConnectionState>("disconnected");
  const [peer, setPeer] = useState<LumaRigPeer | null>(null);
  const [error, setError] = useState("");

  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);
  const operation = useRef(0);
  const refresh = useCallback(() => {
    setState(clientRef.current!.state);
    setPeer(clientRef.current!.peer);
    setLatencyMs(clientRef.current!.latencyMs);
    setLastMessageAt(clientRef.current!.lastMessageAt);
    if (clientRef.current!.lastError) setError(clientRef.current!.lastError);
  }, []);

  const connect = useCallback(async (target: LumaRigPeer) => {
    const currentOperation = ++operation.current;
    setError("");
    setState("connecting");
    try {
      await clientRef.current!.connect(target);
      refresh();
    } catch (cause) {
      if (operation.current === currentOperation) { setError(cause instanceof Error ? cause.message : String(cause)); refresh(); }
      throw cause;
    }
  }, [refresh]);

  const disconnect = useCallback(async () => {
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

  useEffect(() => { const timer = window.setInterval(refresh, 250); return () => { window.clearInterval(timer); void clientRef.current?.disconnect(); }; }, [refresh]);

  return { state, peer, error, latencyMs, lastMessageAt, connect, disconnect, send, resolveSong };
}
