mod bus;
mod engine;
mod error;
mod guide;
mod media;
mod meter;
mod model;
mod service;
mod transport;
mod transition;

use serde_json::Value;
use tauri::State;

pub use service::AudioService;
use guide::{GuideTimelineEventRequest, GuideTransitionEventRequest};
use service::AudioTrackRequest;

fn value<T: serde::Serialize>(input: T) -> Result<Value, String> {
    serde_json::to_value(input).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn audio_initialize(service: State<'_, AudioService>) -> Result<Value, String> {
    let status = service.initialize().map_err(|error| error.to_string())?;
    value(status)
}

#[tauri::command]
pub fn audio_status(service: State<'_, AudioService>) -> Value {
    service.status_json()
}

#[tauri::command]
pub fn audio_load_wav_song(
    tracks: Vec<AudioTrackRequest>,
    service: State<'_, AudioService>,
) -> Result<Value, String> {
    let status = service
        .load_wav_song(tracks)
        .map_err(|error| error.to_string())?;
    value(status)
}

#[tauri::command]
pub fn audio_load_voice_pack(
    directory: String,
    service: State<'_, AudioService>,
) -> Result<Value, String> {
    let status = service
        .load_voice_pack(&directory)
        .map_err(|error| error.to_string())?;
    value(status)
}

#[tauri::command]
pub fn audio_set_guide_timeline(
    events: Vec<GuideTimelineEventRequest>,
    service: State<'_, AudioService>,
) -> Result<Value, String> {
    let status = service
        .set_guide_timeline(events)
        .map_err(|error| error.to_string())?;
    value(status)
}

#[tauri::command]
pub fn audio_play(service: State<'_, AudioService>) -> Result<Value, String> {
    let status = service.play().map_err(|error| error.to_string())?;
    value(status)
}

#[tauri::command]
pub fn audio_pause(service: State<'_, AudioService>) -> Result<Value, String> {
    let status = service.pause().map_err(|error| error.to_string())?;
    value(status)
}

#[tauri::command]
pub fn audio_stop(service: State<'_, AudioService>) -> Result<Value, String> {
    let status = service.stop().map_err(|error| error.to_string())?;
    value(status)
}

#[tauri::command]
pub fn audio_seek(
    seconds: f64,
    service: State<'_, AudioService>,
) -> Result<Value, String> {
    let status = service.seek(seconds).map_err(|error| error.to_string())?;
    value(status)
}

#[tauri::command]
pub fn audio_set_loop(
    start_seconds: f64,
    end_seconds: f64,
    service: State<'_, AudioService>,
) -> Result<(), String> {
    service
        .set_loop(start_seconds, end_seconds)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn audio_clear_loop(service: State<'_, AudioService>) -> Result<(), String> {
    service.clear_loop().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn audio_set_track_gain(
    id: String,
    gain_db: f32,
    service: State<'_, AudioService>,
) -> Result<(), String> {
    service
        .set_track_gain(&id, gain_db)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn audio_set_track_muted(
    id: String,
    muted: bool,
    service: State<'_, AudioService>,
) -> Result<(), String> {
    service
        .set_track_muted(&id, muted)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn audio_set_track_solo(
    id: String,
    solo: bool,
    service: State<'_, AudioService>,
) -> Result<(), String> {
    service
        .set_track_solo(&id, solo)
        .map_err(|error| error.to_string())
}


#[tauri::command]
pub fn audio_schedule_transition(
    target_seconds: f64,
    delay_seconds: f64,
    first_count_delay_seconds: f64,
    beat_seconds: f64,
    count_beats: u64,
    keep_audio: bool,
    #[serde(default)]
    guide_events: Vec<GuideTransitionEventRequest>,
    service: State<'_, AudioService>,
) -> Result<Value, String> {
    let status = service
        .schedule_transition(
            target_seconds,
            delay_seconds,
            first_count_delay_seconds,
            beat_seconds,
            count_beats,
            keep_audio,
            guide_events,
        )
        .map_err(|error| error.to_string())?;
    value(status)
}

#[tauri::command]
pub fn audio_set_bus_gain(
    id: String,
    gain_db: f32,
    service: State<'_, AudioService>,
) -> Result<Value, String> {
    let status = service
        .set_bus_gain(&id, gain_db)
        .map_err(|error| error.to_string())?;
    value(status)
}

#[tauri::command]
pub fn audio_set_bus_muted(
    id: String,
    muted: bool,
    service: State<'_, AudioService>,
) -> Result<Value, String> {
    let status = service
        .set_bus_muted(&id, muted)
        .map_err(|error| error.to_string())?;
    value(status)
}

#[tauri::command]
pub fn audio_cancel_transition(
    service: State<'_, AudioService>,
) -> Result<Value, String> {
    let status = service
        .cancel_transition()
        .map_err(|error| error.to_string())?;
    value(status)
}
