import { describe, expect, it } from "vitest";
import { activeVideoClip } from "./videoRuntime";
import type { VideoProgram } from "./video";

const base: VideoProgram = { output:{displayEnabled:false,ndiEnabled:false,ndiName:"Program"}, clips:[{id:"a",name:"A",source:{kind:"local",path:"/a.mp4",format:"mp4"},timelineStartSeconds:10,sourceInSeconds:20,sourceOutSeconds:30,loop:false,playbackMode:"timeline",enabled:true}] };

describe("video runtime",()=>{
  it("maps master transport into trimmed source time",()=>{ expect(activeVideoClip(base,12)?.sourceSeconds).toBe(22); });
  it("clears after a non-looping trim",()=>{ expect(activeVideoClip(base,20)).toBeNull(); });
  it("wraps a looping trim",()=>{ const p: VideoProgram={...base,clips:[{...base.clips[0],loop:true}]}; expect(activeVideoClip(p,22)?.sourceSeconds).toBe(22); });
  it("resolves section-triggered clips",()=>{ const p: VideoProgram={...base,clips:[{...base.clips[0],playbackMode:"section",sectionId:"chorus"}]}; expect(activeVideoClip(p,0,"chorus")?.sourceSeconds).toBe(20); });
});
