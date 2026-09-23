import { describe, expect, it } from "vitest";
import { createProject } from "./project";
import { createServiceSong } from "./service";
import { missingMedia, projectMediaPaths } from "./preflight";

describe("media preflight", () => {
  it("checks unique audio, pad, and local video files; excludes online links", () => {
    const song = createServiceSong("Opening");
    song.tracks = [{id:"one",name:"Keys",kind:"keys",color:"#fff",enabled:true,muted:false,solo:false,gainDb:0,media:{id:"file",path:"/show/keys.wav",startSeconds:0}}];
    const project = createProject("Service", [song]);
    project.pads = [{id:"pad",name:"Pad",mode:"hold",path:"/show/keys.wav",gainDb:0,octave:0,width:100,attackMs:0,releaseMs:0}];
    project.video!.clips = [{id:"movie",name:"Video",source:{kind:"local",path:"/show/clip.mp4",format:"mp4"},timelineStartSeconds:0,sourceInSeconds:0,loop:false,playbackMode:"manual",enabled:true}];
    expect(projectMediaPaths(project)).toEqual(["/show/keys.wav", "/show/clip.mp4"]);
    expect(missingMedia(projectMediaPaths(project), [{path:"/show/keys.wav",available:true,bytes:300}])).toEqual(["/show/clip.mp4"]);
  });
});
