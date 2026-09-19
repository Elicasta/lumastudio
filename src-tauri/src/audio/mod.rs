mod engine;
mod error;
mod media;
mod meter;
mod model;
mod service;
mod transport;

use serde_json::Value;
use tauri::State;

pub use service::AudioService;
use service::AudioTrackRequest;

#[tauri::command]
pub fn audio_initialize(service: State<'_, AudioService>) -> Result<Value, String> {
    service
        .initialize()
        .and_then(|status| serde_json::to_value(status).map_err(|error| error.into()))
        .map_err(|error| error.to_string())
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
    service
        .load_wav_song(tracks)
        .and_then(|status| serde_json::to_value(status).map_err(|error| error.into()))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn audio_play(service: State<'_, AudioService>) -> Result<Value, String> {
    service
        .play()
        .and_then(|status| serde_json::to_value(status).map_err(|error| error.into()))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn audio_pause(service: State<'_, AudioService>) -> Result<Value, String> {
    service
        .pause()
        .and_then(|status| serde_json::to_value(status).map_err(|error| error.into()))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn audio_stop(service: State<'_, AudioService>) -> Result<Value, String> {
    service
        .stop()
        .and_then(|status| serde_json::to_value(status).map_err(|error| error.into()))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn audio_seek(
    seconds: f64,
    service: State<'_, AudioService>,
) -> Result<Value, String> {
    service
        .seek(seconds)
        .and_then(|status| serde_json::to_value(status).map_err(|error| error.into()))
        .map_err(|error| error.to_string())
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
