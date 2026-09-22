import { invoke } from "@tauri-apps/api/core";
import { isNativeApp } from "./audio";
import type { VideoProgram } from "../domain/video";
export interface LumaVizMediaFrame {type:"lumastudio.media";version:1;outputId:string;timestamp:number;positionSeconds:number;playing:boolean;sectionId?:string;program?:VideoProgram;}
export class LumaVizMediaBus {
 publish(frame:Omit<LumaVizMediaFrame,"type"|"version"|"timestamp">){
  if(!isNativeApp())return;
  const payload:LumaVizMediaFrame={type:"lumastudio.media",version:1,timestamp:Date.now(),...frame};
  void invoke("lumaviz_media_publish",{frame:payload}).catch(()=>undefined);
 }
 close(){}
}
