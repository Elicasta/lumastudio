export type SessionSlotState = 'unloaded' | 'stopped' | 'ready' | 'queued' | 'playing';
export function sessionSlotState(index: number, current: number, queued: number | null, loaded: boolean, playing: boolean): SessionSlotState {
  if (!loaded) return 'unloaded';
  if (index === queued) return 'queued';
  if (index === current) return playing ? 'playing' : 'stopped';
  return 'ready';
}
