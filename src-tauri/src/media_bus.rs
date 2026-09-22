use serde_json::Value;
use std::{io::Write, net::{TcpListener,TcpStream}, sync::{Arc,Mutex}, thread};
use tauri::State;

#[derive(Default)]
pub struct MediaBus { clients:Arc<Mutex<Vec<TcpStream>>> }

impl MediaBus {
 pub fn start(&self){
  let clients=self.clients.clone();
  thread::spawn(move||{
   let Ok(listener)=TcpListener::bind("127.0.0.1:9462") else{return};
   for stream in listener.incoming().flatten(){
    let _=stream.set_nonblocking(true);
    clients.lock().unwrap().push(stream);
   }
  });
 }
}

#[tauri::command]
pub fn lumaviz_media_publish(state:State<'_,MediaBus>, frame:Value)->Result<(),String>{
 let payload=serde_json::to_vec(&frame).map_err(|e|e.to_string())?;
 let mut clients=state.clients.lock().map_err(|e|e.to_string())?;
 clients.retain_mut(|stream| {
   let len=(payload.len() as u32).to_be_bytes();
   stream.write_all(&len).and_then(|_|stream.write_all(&payload)).is_ok()
 });
 Ok(())
}
