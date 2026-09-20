import type { Setlist, Song } from "./types";

export function adjacentSong(
  setlist: Setlist,
  currentSongId: string,
  direction: -1 | 1
): Song | null {
  const index = setlist.songs.findIndex((song) => song.id === currentSongId);
  if (index < 0) return null;

  const target = index + direction;
  if (target < 0 || target >= setlist.songs.length) return null;

  return setlist.songs[target] ?? null;
}
