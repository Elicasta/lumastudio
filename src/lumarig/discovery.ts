import type { LumaRigPeer } from "./protocol";

export const LUMARIG_DEFAULT_PORT = 47777;

export function loopbackLumaRigPeer(port = LUMARIG_DEFAULT_PORT): LumaRigPeer {
  return {
    id: "local-lumarig",
    name: "LumaRig on this computer",
    transport: "local",
    endpoint: `ws://127.0.0.1:${port}/studio`
  };
}

// Native mDNS discovery will populate LAN peers advertising _lumarig._tcp.
// Keeping loopback explicit lets Studio connect without network discovery or cloud relay.
export function preferredLumaRigPeers(discovered: LumaRigPeer[]) {
  return [
    loopbackLumaRigPeer(),
    ...discovered.filter((peer) => peer.transport === "lan"),
    ...discovered.filter((peer) => peer.transport === "relay")
  ];
}
