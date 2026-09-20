import { useCallback, useEffect, useRef, useState } from "react";
import { LumaRigClient, type LumaRigConnectionState } from "../lumarig/client";
import type { LumaRigCommand, LumaRigPeer, LumaRigSongIdentity } from "../lumarig/protocol";

export function useLumaRig() {
  const clientRef = useRef<LumaRigClient | null>(null);
  if (!clientRef.current) clientRef.current = new LumaRigClient();
  const [state, setState] = useState<LumaRigConnectionState>("disconnected");
  const [peer, setPeer] = useState<LumaRigPeer | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    setState(clientRef.current!.state);
    setPeer(clientRef.current!.peer);
  }, []);

  const connect = useCallback(async (target: LumaRigPeer) => {
    setError("");
    setState("connecting");
    try {
      await clientRef.current!.connect(target);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState("disconnected");
      throw cause;
    }
  }, [refresh]);

  const disconnect = useCallback(async () => {
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

  useEffect(() => () => { void clientRef.current?.disconnect(); }, []);

  return { state, peer, error, connect, disconnect, send, resolveSong };
}
