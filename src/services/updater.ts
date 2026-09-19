import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateResult {
  state: "current" | "available" | "installed" | "unavailable" | "error";
  message: string;
}

export async function checkForAppUpdate(
  install = false
): Promise<UpdateResult> {
  try {
    const update = await check();

    if (!update) {
      return { state: "current", message: "LumaRig Studio is up to date." };
    }

    if (!install) {
      return {
        state: "available",
        message: "Version " + update.version + " is available."
      };
    }

    await update.downloadAndInstall();
    await relaunch();

    return { state: "installed", message: "Update installed. Restarting…" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("__TAURI_UPDATER_PUBLIC_KEY__")) {
      return {
        state: "unavailable",
        message: "Updater signing key has not been configured yet."
      };
    }
    return { state: "error", message };
  }
}
