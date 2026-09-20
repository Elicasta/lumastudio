use std::{path::Path, sync::Mutex};

use serde::{Deserialize, Serialize};

use super::{
    engine::{AudioEngine, AudioEngineStatus},
    error::AudioError,
    guide::{
        load_voice_pack, GuideTimelineEventRequest, GuideTransitionEventRequest,
    },
    media::{load_wav_track, WavTrackRequest},
    model::{SongMix, TrackBus},
    pad::PadSample,
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
    #[serde(default = "default_track_bus")]
    pub bus: String,
}

fn default_track_bus() -> String {
    "music".into()
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

            let bus = TrackBus::from_id(&request.bus)
                .ok_or_else(|| AudioError::BusNotFound(request.bus.clone()))?;

            tracks.push(load_wav_track(
                &WavTrackRequest {
                    id: request.id,
                    name: request.name,
                    path: request.path,
                    gain_db: request.gain_db,
                    start_frame,
                    bus,
                },
                sample_rate,
            )?);
        }

        engine.replace_song(SongMix::new(tracks));
        Ok(engine.status())
    }

    pub fn load_pad(&self, index: usize, path: &str, looped: bool, gain_db: f32, width: f32, octave: i32) -> Result<(), AudioError> {
        let mut guard = self.engine.lock().expect("audio engine mutex poisoned");
        if guard.is_none() { *guard = Some(AudioEngine::new()?); }
        let engine = guard.as_ref().expect("initialized above");
        let track = load_wav_track(&WavTrackRequest {
            id: format!("pad-{}", index + 1),
            name: format!("Pad {}", index + 1),
            path: path.to_string(),
            gain_db: 0.0,
            start_frame: 0,
            bus: TrackBus::Music,
        }, engine.sample_rate())?;
        engine.load_pad(index, PadSample {
            id: track.id,
            samples: track.samples,
            looped,
            gain: 1.0,
            width: width.clamp(0.0, 2.0),
            playback_rate: 2.0_f32.powi(octave.clamp(-2, 2)),
        })?;
        engine.configure_pad(index, gain_db, width)?;
        Ok(())
    }

    pub fn trigger_pad(&self, index: usize) -> Result<(), AudioError> { self.with_engine(|engine| engine.trigger_pad(index))? }
    pub fn stop_pad(&self, index: usize) -> Result<(), AudioError> { self.with_engine(|engine| engine.stop_pad(index))? }
    pub fn configure_pad(&self, index: usize, gain_db: f32, width: f32) -> Result<(), AudioError> { self.with_engine(|engine| engine.configure_pad(index, gain_db, width))? }

    pub fn load_voice_pack(&self, directory: &str) -> Result<AudioEngineStatus, AudioError> {
        let mut guard = self.engine.lock().expect("audio engine mutex poisoned");

        if guard.is_none() {
            *guard = Some(AudioEngine::new()?);
        }

        let engine = guard.as_ref().expect("initialized above");
        let pack = load_voice_pack(Path::new(directory), engine.sample_rate())?;
        engine.replace_voice_pack(pack);
        Ok(engine.status())
    }

    pub fn set_guide_timeline(
        &self,
        events: Vec<GuideTimelineEventRequest>,
    ) -> Result<AudioEngineStatus, AudioError> {
        self.with_engine(|engine| {
            engine.set_guide_timeline(&events)?;
            Ok(engine.status())
        })?
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
        pulses_per_bar: u64,
        click_enabled: bool,
        keep_audio: bool,
        guide_events: Vec<GuideTransitionEventRequest>,
    ) -> Result<AudioEngineStatus, AudioError> {
        self.with_engine(|engine| {
            engine.schedule_transition_seconds(
                target_seconds,
                delay_seconds,
                first_count_delay_seconds,
                beat_seconds,
                count_beats,
                pulses_per_bar,
                click_enabled,
                keep_audio,
                &guide_events,
            )?;
            Ok(engine.status())
        })?
    }

    pub fn cancel_transition(&self) -> Result<AudioEngineStatus, AudioError> {
        self.with_engine(|engine| {
            engine.cancel_transition();
            engine.status()
        })
    }

    pub fn set_bus_gain(&self, id: &str, gain_db: f32) -> Result<AudioEngineStatus, AudioError> {
        self.with_engine(|engine| {
            engine.set_bus_gain_db(id, gain_db)?;
            Ok(engine.status())
        })?
    }

    pub fn set_bus_muted(&self, id: &str, muted: bool) -> Result<AudioEngineStatus, AudioError> {
        self.with_engine(|engine| {
            engine.set_bus_muted(id, muted)?;
            Ok(engine.status())
        })?
    }

    pub fn set_bus_route(
        &self,
        id: &str,
        output_left: u16,
        output_right: u16,
    ) -> Result<AudioEngineStatus, AudioError> {
        self.with_engine(|engine| {
            engine.set_bus_route(id, output_left, output_right)?;
            Ok(engine.status())
        })?
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
