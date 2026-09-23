import type { StudioProject } from "./project";

export interface MediaFileStatus { path: string; available: boolean; bytes: number }

export function projectMediaPaths(project: StudioProject): string[] {
  const paths = [
    ...project.setlist.songs.flatMap(song => song.tracks.flatMap(track => track.media?.path ? [track.media.path] : [])),
    ...(project.pads ?? []).flatMap(pad => pad.path ? [pad.path] : []),
    ...(project.video?.clips ?? []).flatMap(clip => clip.source.kind === "local" ? [clip.source.path] : [])
  ];
  return [...new Set(paths)];
}

export function missingMedia(paths: string[], result: MediaFileStatus[]): string[] {
  const found = new Map(result.map(item => [item.path, item.available && item.bytes > 0]));
  return paths.filter(path => found.get(path) !== true);
}
