import { describe, expect, it } from 'vitest';
import { sessionSlotState } from './session';
describe('session launch feedback',()=>{
 it('never labels unloaded audio playing',()=>expect(sessionSlotState(0,0,null,false,true)).toBe('unloaded'));
 it('distinguishes cued stopped from playing',()=>{expect(sessionSlotState(0,0,null,true,false)).toBe('stopped');expect(sessionSlotState(0,0,null,true,true)).toBe('playing');});
 it('shows a queued relaunch even for the current section',()=>expect(sessionSlotState(1,1,1,true,true)).toBe('queued'));
 it('keeps other sections ready while one plays',()=>expect(sessionSlotState(2,0,1,true,true)).toBe('ready'));
});
