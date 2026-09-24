export type SessionSlotState = 'unloaded' | 'stopped' | 'ready' | 'queued' | 'playing';
export function sessionTrackSuppression(track: { muted: boolean; solo: boolean }, anyLoadedSolo: boolean): string | null {
  if (track.muted) return 'MUTED';
  if (anyLoadedSolo && !track.solo) return 'EXCLUDED BY SOLO';
  return null;
}
export function sessionSlotState(index: number, current: number, queued: number | null, loaded: boolean, playing: boolean): SessionSlotState {
  if (!loaded) return 'unloaded';
  if (index === queued) return 'queued';
  if (index === current) return playing ? 'playing' : 'stopped';
  return 'ready';
}
