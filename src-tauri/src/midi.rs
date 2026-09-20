use midir::{MidiOutput, MidiOutputConnection};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct MidiService { connection: Mutex<Option<MidiOutputConnection>> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiPort { pub index: usize, pub name: String }

fn output() -> Result<MidiOutput, String> { MidiOutput::new("LumaRig Studio").map_err(|e| e.to_string()) }

#[tauri::command]
pub fn midi_list_outputs() -> Result<Vec<MidiPort>, String> {
    let midi = output()?;
    midi.ports().iter().enumerate().map(|(index, port)| {
        Ok(MidiPort { index, name: midi.port_name(port).map_err(|e| e.to_string())? })
    }).collect()
}

#[tauri::command]
pub fn midi_connect_output(index: usize, service: State<MidiService>) -> Result<String, String> {
    let midi = output()?;
    let ports = midi.ports();
    let port = ports.get(index).ok_or("MIDI output no longer exists")?;
    let name = midi.port_name(port).map_err(|e| e.to_string())?;
    let connection = midi.connect(port, "LumaRig Studio Output").map_err(|e| e.to_string())?;
    *service.connection.lock().map_err(|_| "MIDI service lock poisoned")? = Some(connection);
    Ok(name)
}

#[tauri::command]
pub fn midi_disconnect_output(service: State<MidiService>) -> Result<(), String> {
    service.connection.lock().map_err(|_| "MIDI service lock poisoned")?.take();
    Ok(())
}

#[tauri::command]
pub fn midi_send(bytes: Vec<u8>, service: State<MidiService>) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > 1024 { return Err("Invalid MIDI message length".into()); }
    let mut guard = service.connection.lock().map_err(|_| "MIDI service lock poisoned")?;
    let connection = guard.as_mut().ok_or("No MIDI output connected")?;
    connection.send(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn midi_program_change(channel: u8, program: u8, service: State<MidiService>) -> Result<(), String> {
    if !(1..=16).contains(&channel) || program > 127 { return Err("MIDI channel must be 1-16 and program 0-127".into()); }
    midi_send(vec![0xC0 | (channel - 1), program], service)
}

#[tauri::command]
pub fn midi_control_change(channel: u8, controller: u8, value: u8, service: State<MidiService>) -> Result<(), String> {
    if !(1..=16).contains(&channel) || controller > 127 || value > 127 { return Err("Invalid MIDI CC".into()); }
    midi_send(vec![0xB0 | (channel - 1), controller, value], service)
}
