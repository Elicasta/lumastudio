use crossbeam_queue::ArrayQueue;
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
const LIVE_MIDI_CAPACITY: usize = 4_096;

#[derive(Debug, Clone, Copy)]
pub struct MidiRealtimeMessage {
    pub bytes: [u8; 3],
    pub len: u8,
}

pub type LiveMidiQueue = Arc<ArrayQueue<MidiRealtimeMessage>>;

pub fn new_live_midi_queue() -> LiveMidiQueue {
    Arc::new(ArrayQueue::new(LIVE_MIDI_CAPACITY))
}

pub struct MidiService {
    output_connection: Mutex<Option<MidiOutputConnection>>,
    input_connection: Mutex<Option<MidiInputConnection<()>>>,
    captured: Arc<Mutex<VecDeque<MidiCapturedMessage>>>,
    live_midi: LiveMidiQueue,
}

impl MidiService {
    pub fn new(live_midi: LiveMidiQueue) -> Self {
        Self {
            output_connection: Mutex::new(None),
            input_connection: Mutex::new(None),
            captured: Arc::new(Mutex::new(VecDeque::with_capacity(1024))),
            live_midi,
        }
    }
}

impl Default for MidiService {
    fn default() -> Self {
        Self::new(new_live_midi_queue())
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

fn realtime_message(bytes: &[u8]) -> Option<MidiRealtimeMessage> {
    let status = *bytes.first()?;
    let family = status & 0xf0;
    if !(0x80..=0xe0).contains(&family) {
        return None;
    }

    let len = if family == 0xc0 || family == 0xd0 { 2 } else { 3 };
    if bytes.len() < len {
        return None;
    }

    Some(MidiRealtimeMessage {
        bytes: [
            status,
            bytes.get(1).copied().unwrap_or(0),
            bytes.get(2).copied().unwrap_or(0),
        ],
        len: len as u8,
    })
}

fn push_live(queue: &ArrayQueue<MidiRealtimeMessage>, message: MidiRealtimeMessage) {
    if queue.push(message).is_err() {
        let _ = queue.pop();
        let _ = queue.push(message);
    }
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
    while service.live_midi.pop().is_some() {}

    let captured = Arc::clone(&service.captured);
    let live_midi = Arc::clone(&service.live_midi);
    let started = Instant::now();
    let connection = midi
        .connect(
            port,
            "LumaStudio Input",
            move |_timestamp, bytes, _| {
                if bytes.is_empty() {
                    return;
                }

                if let Some(message) = realtime_message(bytes) {
                    push_live(&live_midi, message);
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
    while service.live_midi.pop().is_some() {}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_channel_voice_messages_for_realtime_routing() {
        let note = realtime_message(&[0x90, 60, 100]).unwrap();
        assert_eq!(note.len, 3);
        assert_eq!(note.bytes, [0x90, 60, 100]);

        let program = realtime_message(&[0xc2, 12]).unwrap();
        assert_eq!(program.len, 2);
        assert_eq!(program.bytes, [0xc2, 12, 0]);
    }

    #[test]
    fn ignores_system_messages_for_the_realtime_instrument_queue() {
        assert!(realtime_message(&[0xf8]).is_none());
        assert!(realtime_message(&[0xf0, 1, 2, 0xf7]).is_none());
    }
}
