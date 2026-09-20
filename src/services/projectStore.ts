import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { parseProject, serializeProject, type StudioProject } from "../domain/project";

export async function saveProject(project: StudioProject, path?: string) {
  const target = path ?? await save({
    title: "Save LumaRig Studio Project",
    defaultPath: `${project.name}.lumarigstudio`,
    filters: [{ name: "LumaRig Studio Project", extensions: ["lumarigstudio"] }]
  });
  if (!target) return null;
  await writeTextFile(target, serializeProject(project));
  return target;
}

export async function openProject() {
  const path = await open({
    title: "Open LumaRig Studio Project",
    multiple: false,
    filters: [{ name: "LumaRig Studio Project", extensions: ["lumarigstudio"] }]
  });
  if (!path || Array.isArray(path)) return null;
  return { path, project: parseProject(await readTextFile(path)) };
}
