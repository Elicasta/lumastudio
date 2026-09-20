import { invoke } from "@tauri-apps/api/core";

export interface LumaLinkNode {
  address: string;
  nodeName: string;
  platform: string;
  appVersion: string;
  protocolVersion: number;
  capabilities: string[];
  suggestedProPresenterPort: number;
}

export const discoverLumaLinkNodes = (timeoutMs = 900) =>
  invoke<LumaLinkNode[]>("lumalink_discover", { timeoutMs });
