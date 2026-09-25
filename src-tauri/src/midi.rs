use midir::{
    Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection,
};
use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::Instant,
};
use tauri::State;

const MAX_CAPTURED_MESSAGES: usize = 16_384;

pub struct MidiService {
    output_connection: Mutex<Option<MidiOutputConnection>>,
    input_connection: Mutex<Option<MidiInputConnection<()>>>,
    captured: Arc<Mutex<VecDeque<MidiCapturedMessage>>>,
}

impl Default for MidiService {
    fn default() -> Self {
        Self {
            output_connection: Mutex::new(None),
            input_connection: Mutex::new(None),
            captured: Arc::new(Mutex::new(VecDeque::with_capacity(1024))),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiPort {
    pub index: usize,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiDeviceSnapshot {
    pub inputs: Vec<MidiPort>,
    pub outputs: Vec<MidiPort>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiCapturedMessage {
    pub timestamp_micros: u64,
    pub bytes: Vec<u8>,
}

fn output() -> Result<MidiOutput, String> {
    MidiOutput::new("LumaStudio").map_err(|error| error.to_string())
}

fn input() -> Result<MidiInput, String> {
    let mut midi = MidiInput::new("LumaStudio").map_err(|error| error.to_string())?;
    midi.ignore(Ignore::None);
    Ok(midi)
}

fn list_outputs() -> Result<Vec<MidiPort>, String> {
    let midi = output()?;
    midi.ports()
        .iter()
        .enumerate()
        .map(|(index, port)| {
            Ok(MidiPort {
                index,
                name: midi.port_name(port).map_err(|error| error.to_string())?,
            })
        })
        .collect()
}

fn list_inputs() -> Result<Vec<MidiPort>, String> {
    let midi = input()?;
    midi.ports()
        .iter()
        .enumerate()
        .map(|(index, port)| {
            Ok(MidiPort {
                index,
                name: midi.port_name(port).map_err(|error| error.to_string())?,
            })
        })
        .collect()
}

#[tauri::command]
pub fn midi_scan() -> Result<MidiDeviceSnapshot, String> {
    Ok(MidiDeviceSnapshot {
        inputs: list_inputs()?,
        outputs: list_outputs()?,
    })
}

#[tauri::command]
pub fn midi_list_outputs() -> Result<Vec<MidiPort>, String> {
    list_outputs()
}

#[tauri::command]
pub fn midi_list_inputs() -> Result<Vec<MidiPort>, String> {
    list_inputs()
}

#[tauri::command]
pub fn midi_connect_output(index: usize, service: State<MidiService>) -> Result<String, String> {
    let midi = output()?;
    let ports = midi.ports();
    let port = ports
        .get(index)
        .ok_or("MIDI output no longer exists")?;
    let name = midi
        .port_name(port)
        .map_err(|error| error.to_string())?;
    let connection = midi
        .connect(port, "LumaStudio Output")
        .map_err(|error| error.to_string())?;

    *service
        .output_connection
        .lock()
        .map_err(|_| "MIDI service lock poisoned")? = Some(connection);

    Ok(name)
}

#[tauri::command]
pub fn midi_connect_input(index: usize, service: State<MidiService>) -> Result<String, String> {
    let midi = input()?;
    let ports = midi.ports();
    let port = ports
        .get(index)
        .ok_or("MIDI input no longer exists")?;
    let name = midi
        .port_name(port)
        .map_err(|error| error.to_string())?;

    {
        let mut queue = service
            .captured
            .lock()
            .map_err(|_| "MIDI capture queue lock poisoned")?;
        queue.clear();
    }

    let captured = Arc::clone(&service.captured);
    let started = Instant::now();
    let connection = midi
        .connect(
            port,
            "LumaStudio Input",
            move |_timestamp, bytes, _| {
                if bytes.is_empty() {
                    return;
                }

                if let Ok(mut queue) = captured.lock() {
                    if queue.len() >= MAX_CAPTURED_MESSAGES {
                        queue.pop_front();
                    }
                    queue.push_back(MidiCapturedMessage {
                        timestamp_micros: started.elapsed().as_micros() as u64,
                        bytes: bytes.to_vec(),
                    });
                }
            },
            (),
        )
        .map_err(|error| error.to_string())?;

    *service
        .input_connection
        .lock()
        .map_err(|_| "MIDI service lock poisoned")? = Some(connection);

    Ok(name)
}

#[tauri::command]
pub fn midi_disconnect_output(service: State<MidiService>) -> Result<(), String> {
    service
        .output_connection
        .lock()
        .map_err(|_| "MIDI service lock poisoned")?
        .take();
    Ok(())
}

#[tauri::command]
pub fn midi_disconnect_input(service: State<MidiService>) -> Result<(), String> {
    service
        .input_connection
        .lock()
        .map_err(|_| "MIDI service lock poisoned")?
        .take();

    service
        .captured
        .lock()
        .map_err(|_| "MIDI capture queue lock poisoned")?
        .clear();

    Ok(())
}

#[tauri::command]
pub fn midi_drain_input(
    max_messages: Option<usize>,
    service: State<MidiService>,
) -> Result<Vec<MidiCapturedMessage>, String> {
    let limit = max_messages.unwrap_or(1024).clamp(1, MAX_CAPTURED_MESSAGES);
    let mut queue = service
        .captured
        .lock()
        .map_err(|_| "MIDI capture queue lock poisoned")?;

    let count = limit.min(queue.len());
    Ok(queue.drain(..count).collect())
}

#[tauri::command]
pub fn midi_send(bytes: Vec<u8>, service: State<MidiService>) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > 1024 {
        return Err("Invalid MIDI message length".into());
    }

    let mut guard = service
        .output_connection
        .lock()
        .map_err(|_| "MIDI service lock poisoned")?;
    let connection = guard
        .as_mut()
        .ok_or("No MIDI output connected")?;

    connection.send(&bytes).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn midi_program_change(
    channel: u8,
    program: u8,
    service: State<MidiService>,
) -> Result<(), String> {
    if !(1..=16).contains(&channel) || program > 127 {
        return Err("MIDI channel must be 1-16 and program 0-127".into());
    }

    midi_send(vec![0xC0 | (channel - 1), program], service)
}

#[tauri::command]
pub fn midi_control_change(
    channel: u8,
    controller: u8,
    value: u8,
    service: State<MidiService>,
) -> Result<(), String> {
    if !(1..=16).contains(&channel) || controller > 127 || value > 127 {
        return Err("Invalid MIDI CC".into());
    }

    midi_send(vec![0xB0 | (channel - 1), controller, value], service)
}
