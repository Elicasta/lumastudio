import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LumaRigClient } from "./client";
import { loopbackLumaRigPeer } from "./discovery";
class Socket {
  static OPEN=1; static instances: Socket[]=[];
  readyState=0; onopen: (()=>void)|null=null; onerror:(()=>void)|null=null;
  onclose:(()=>void)|null=null; onmessage:((event:{data:string})=>void)|null=null;
  sent: string[]=[]; throwSend=false;
  constructor(public url:string) { Socket.instances.push(this); }
  open(){this.readyState=1;this.onopen?.();}
  close(){this.readyState=3;}
  closed(){this.close();this.onclose?.();}
  send(data:string){if(this.throwSend)throw new Error("write failed");this.sent.push(data);}
  reply(payload:unknown={protocol:1,app:"LumaRig"}){const request=JSON.parse(this.sent.at(-1)!);this.onmessage?.({data:JSON.stringify({id:request.id,ok:true,payload})});}
}
async function connected(client:LumaRigClient){const promise=client.connect(loopbackLumaRigPeer());const socket=Socket.instances.at(-1)!;socket.open();await Promise.resolve();socket.reply();await promise;return socket;}
beforeEach(()=>{vi.useFakeTimers();Socket.instances=[];vi.stubGlobal("WebSocket",Socket);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe("LumaRig connection lifecycle",()=>{
  it("stays connecting until the compatible handshake completes",async()=>{const c=new LumaRigClient();const p=c.connect(loopbackLumaRigPeer());const s=Socket.instances[0];s.open();await Promise.resolve();expect(c.state).toBe("connecting");await expect(c.send({type:"cue.go"})).rejects.toThrow("negotiating");s.reply();await p;expect(c.state).toBe("connected");});
  it("ignores late close and messages from a replaced socket",async()=>{const c=new LumaRigClient();const old=await connected(c);const active=await connected(c);old.closed();old.onmessage?.({data:"bad"});expect(c.state).toBe("connected");const result=c.send({type:"cue.go"});active.reply();expect((await result).ok).toBe(true);await c.disconnect();});
  it("settles a superseded connect immediately",async()=>{const c=new LumaRigClient();const first=c.connect(loopbackLumaRigPeer()).catch(e=>e.message);await connected(c);expect(await first).toMatch(/cancelled/);expect(c.state).toBe("connected");await c.disconnect();});
  it("closes a timed-out socket and ignores a late open",async()=>{const c=new LumaRigClient();const p=c.connect(loopbackLumaRigPeer()).catch(e=>e.message);const s=Socket.instances[0];await vi.advanceTimersByTimeAsync(5001);expect(await p).toMatch(/timed out/);expect(s.readyState).toBe(3);s.open();expect(c.state).toBe("disconnected");});
  it("rejects incompatible handshakes",async()=>{const c=new LumaRigClient();const p=c.connect(loopbackLumaRigPeer()).catch(e=>e.message);const s=Socket.instances[0];s.open();await Promise.resolve();s.reply({protocol:99,app:"LumaRig"});expect(await p).toMatch(/incompatible/);expect(c.state).toBe("disconnected");});
  it("captures Rig runtime state from the handshake",async()=>{const c=new LumaRigClient();const p=c.connect(loopbackLumaRigPeer());const s=Socket.instances[0];s.open();await Promise.resolve();s.reply({protocol:1,app:"LumaRig",status:{blackout:true,currentCueId:"cue-live",activeEffectId:null}});await p;expect(c.runtimeStatus).toEqual({blackout:true,currentCueId:"cue-live",activeEffectId:null});await c.disconnect();expect(c.runtimeStatus).toBeNull();});
  it("rejects malformed Rig runtime state in the handshake",async()=>{const c=new LumaRigClient();const p=c.connect(loopbackLumaRigPeer()).catch(e=>e.message);const s=Socket.instances[0];s.open();await Promise.resolve();s.reply({protocol:1,app:"LumaRig",status:{blackout:"yes",currentCueId:null,activeEffectId:null}});expect(await p).toMatch(/invalid runtime status/);expect(c.state).toBe("disconnected");});
  it("settles pending commands on disconnect",async()=>{const c=new LumaRigClient();const s=await connected(c);const result=c.send({type:"cue.go"});s.closed();expect((await result).ok).toBe(false);expect(vi.getTimerCount()).toBe(0);});
  it("cleans up failed sends",async()=>{const c=new LumaRigClient();const s=await connected(c);s.throwSend=true;expect((await c.send({type:"cue.go"})).error).toContain("write failed");expect(vi.getTimerCount()).toBe(0);await c.disconnect();});
  it("rejects malformed success responses and bounds command timeout",async()=>{const c=new LumaRigClient();const s=await connected(c);const p=c.send({type:"cue.go"});const {id}=JSON.parse(s.sent.at(-1)!);s.onmessage?.({data:JSON.stringify({id,ok:"yes"})});expect(c.state).toBe("degraded");await vi.advanceTimersByTimeAsync(4001);expect((await p).ok).toBe(false);expect(vi.getTimerCount()).toBe(0);await c.disconnect();});
});
