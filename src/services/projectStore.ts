import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { parseProject, serializeProject, type StudioProject } from "../domain/project";

export async function saveProject(project: StudioProject, path?: string) {
  const target = path ?? await save({
    title: "Save LumaRig Studio Project",
    defaultPath: `${project.name}.lumarigstudio`,
    filters: [{ name: "LumaRig Studio Project", extensions: ["lumarigstudio"] }]
  });
  if (!target) return null;
  await invoke("project_write", { path: target, contents: serializeProject(project) });
  return target;
}

export async function openProject() {
  const path = await open({
    title: "Open LumaRig Studio Project",
    multiple: false,
    filters: [{ name: "LumaRig Studio Project", extensions: ["lumarigstudio"] }]
  });
  if (!path || Array.isArray(path)) return null;
  const raw = await invoke<string>("project_read", { path });
  return { path, project: parseProject(raw) };
}
