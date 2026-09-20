import { useEffect, useRef, useState } from "react";
import type {
  RemoteCommandAck,
  RemoteCommandEnvelope,
  RemoteStudioState
} from "../remote/protocol";
import {
  getStudioInstanceId,
  RemoteRelay,
  type RemoteRelayStatus,
  type RemoteSessionInfo
} from "../services/remoteRelay";

export function useRemoteRelay(
  state: RemoteStudioState,
  onCommand: (command: RemoteCommandEnvelope) => Promise<RemoteCommandAck>
) {
  const relayRef = useRef<RemoteRelay | null>(null);
  const commandRef = useRef(onCommand);
  const [status, setStatus] = useState<RemoteRelayStatus>("idle");
  const [session, setSession] = useState<RemoteSessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  commandRef.current = onCommand;

  useEffect(() => {
    const relay = new RemoteRelay(getStudioInstanceId(), {
      onStatus: setStatus,
      onSession: setSession,
      onError: setError,
      onCommand: (command) => commandRef.current(command)
    });

    relayRef.current = relay;
    void relay.start();

    return () => {
      relayRef.current = null;
      void relay.stop();
    };
  }, []);

  useEffect(() => {
    relayRef.current?.queueState(state);
  }, [state]);

  return {
    status,
    session,
    error,
    rotatePairCode: () => relayRef.current?.rotatePairCode(),
    restart: () => relayRef.current?.restart()
  };
}
