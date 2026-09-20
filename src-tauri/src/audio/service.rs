use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::{
    engine::{AudioEngine, AudioEngineStatus},
    error::AudioError,
    media::{load_wav_track, WavTrackRequest},
    model::SongMix,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackRequest {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub gain_db: f32,
    #[serde(default)]
    pub start_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninitializedAudioStatus {
    pub initialized: bool,
    pub last_error: Option<String>,
}

pub struct AudioService {
    engine: Mutex<Option<AudioEngine>>,
    last_error: Mutex<Option<String>>,
}

impl Default for AudioService {
    fn default() -> Self {
        Self {
            engine: Mutex::new(None),
            last_error: Mutex::new(None),
        }
    }
}

impl AudioService {
    pub fn initialize(&self) -> Result<AudioEngineStatus, AudioError> {
        let mut guard = self.engine.lock().expect("audio engine mutex poisoned");

        if guard.is_none() {
            match AudioEngine::new() {
                Ok(engine) => {
                    *self.last_error.lock().expect("audio error mutex poisoned") = None;
                    *guard = Some(engine);
                }
                Err(error) => {
                    *self.last_error.lock().expect("audio error mutex poisoned") =
                        Some(error.to_string());
                    return Err(error);
                }
            }
        }

        Ok(guard.as_ref().expect("initialized above").status())
    }

    pub fn status_json(&self) -> serde_json::Value {
        let guard = self.engine.lock().expect("audio engine mutex poisoned");

        match guard.as_ref() {
            Some(engine) => serde_json::to_value(engine.status())
                .expect("audio engine status is serializable"),
            None => serde_json::to_value(UninitializedAudioStatus {
                initialized: false,
                last_error: self
                    .last_error
                    .lock()
                    .expect("audio error mutex poisoned")
                    .clone(),
            })
            .expect("audio status is serializable"),
        }
    }

    pub fn load_wav_song(&self, requests: Vec<AudioTrackRequest>) -> Result<AudioEngineStatus, AudioError> {
        let mut guard = self.engine.lock().expect("audio engine mutex poisoned");

        if guard.is_none() {
            *guard = Some(AudioEngine::new()?);
        }

        let engine = guard.as_ref().expect("initialized above");
        let sample_rate = engine.sample_rate();

        let mut tracks = Vec::with_capacity(requests.len());
        for request in requests {
            let start_frame =
                (request.start_seconds.max(0.0) * sample_rate as f64).round() as u64;

            tracks.push(load_wav_track(
                &WavTrackRequest {
                    id: request.id,
                    name: request.name,
                    path: request.path,
                    gain_db: request.gain_db,
                    start_frame,
                },
                sample_rate,
            )?);
        }

        engine.replace_song(SongMix::new(tracks));
        Ok(engine.status())
    }

    pub fn play(&self) -> Result<AudioEngineStatus, AudioError> {
        self.with_engine(|engine| {
            engine.play();
            engine.status()
        })
    }

    pub fn pause(&self) -> Result<AudioEngineStatus, AudioError> {
        self.with_engine(|engine| {
            engine.pause();
            engine.status()
        })
    }

    pub fn stop(&self) -> Result<AudioEngineStatus, AudioError> {
        self.with_engine(|engine| {
            engine.stop();
            engine.status()
        })
    }

    pub fn seek(&self, seconds: f64) -> Result<AudioEngineStatus, AudioError> {
        self.with_engine(|engine| {
            engine.seek_seconds(seconds);
            engine.status()
        })
    }

    pub fn schedule_transition(
        &self,
        target_seconds: f64,
        delay_seconds: f64,
        first_count_delay_seconds: f64,
        beat_seconds: f64,
        count_beats: u64,
        keep_audio: bool,
    ) -> Result<AudioEngineStatus, AudioError> {
        self.with_engine(|engine| {
            engine.schedule_transition_seconds(
                target_seconds,
                delay_seconds,
                first_count_delay_seconds,
                beat_seconds,
                count_beats,
                keep_audio,
            );
            engine.status()
        })
    }

    pub fn cancel_transition(&self) -> Result<AudioEngineStatus, AudioError> {
        self.with_engine(|engine| {
            engine.cancel_transition();
            engine.status()
        })
    }

    pub fn set_loop(&self, start_seconds: f64, end_seconds: f64) -> Result<(), AudioError> {
        self.with_engine(|engine| engine.set_loop_seconds(start_seconds, end_seconds))
    }

    pub fn clear_loop(&self) -> Result<(), AudioError> {
        self.with_engine(AudioEngine::clear_loop)
    }

    pub fn set_track_gain(&self, id: &str, gain_db: f32) -> Result<(), AudioError> {
        self.with_engine(|engine| engine.set_track_gain_db(id, gain_db))?
    }

    pub fn set_track_muted(&self, id: &str, muted: bool) -> Result<(), AudioError> {
        self.with_engine(|engine| engine.set_track_muted(id, muted))?
    }

    pub fn set_track_solo(&self, id: &str, solo: bool) -> Result<(), AudioError> {
        self.with_engine(|engine| engine.set_track_solo(id, solo))?
    }

    fn with_engine<T>(&self, operation: impl FnOnce(&AudioEngine) -> T) -> Result<T, AudioError> {
        let guard = self.engine.lock().expect("audio engine mutex poisoned");
        let engine = guard.as_ref().ok_or(AudioError::NotInitialized)?;
        Ok(operation(engine))
    }
}
