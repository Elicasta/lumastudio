import type { VideoProgram } from "../domain/video";

export interface LumaVizMediaFrame {
  type:"lumastudio.media";
  version:1;
  outputId:string;
  timestamp:number;
  positionSeconds:number;
  playing:boolean;
  sectionId?:string;
  program?:VideoProgram;
}

export class LumaVizMediaBus {
  private socket?:WebSocket;
  constructor(public url="ws://127.0.0.1:9462/media"){}
  connect(){
    if(this.socket?.readyState===WebSocket.OPEN||this.socket?.readyState===WebSocket.CONNECTING)return;
    try{this.socket=new WebSocket(this.url);}catch{this.socket=undefined;}
  }
  publish(frame:Omit<LumaVizMediaFrame,"type"|"version"|"timestamp">){
    this.connect();
    if(this.socket?.readyState!==WebSocket.OPEN)return;
    this.socket.send(JSON.stringify({type:"lumastudio.media",version:1,timestamp:Date.now(),...frame} satisfies LumaVizMediaFrame));
  }
  close(){this.socket?.close();this.socket=undefined;}
}
