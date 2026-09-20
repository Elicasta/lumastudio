use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use arc_swap::ArcSwap;
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    FromSample, Sample, SampleFormat, SizedSample, Stream, StreamConfig,
};
use serde::Serialize;

use super::{
    error::AudioError,
    meter::StereoMeter,
    model::SongMix,
    transition::ScheduledTransition,
    transport::Transport,
};

pub struct RealtimeState {
    pub mix: ArcSwap<SongMix>,
    pub transport: Transport,
    pub meter: StereoMeter,
    pub transition: ScheduledTransition,
    pub device_error: AtomicBool,
}

impl RealtimeState {
    fn new() -> Self {
        Self {
            mix: ArcSwap::from_pointee(SongMix::empty()),
            transport: Transport::new(),
            meter: StereoMeter::new(),
            transition: ScheduledTransition::new(),
            device_error: AtomicBool::new(false),
        }
    }
}

pub struct AudioEngine {
    realtime: Arc<RealtimeState>,
    _stream: Stream,
    device_name: String,
    sample_rate: u32,
    output_channels: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioEngineStatus {
    pub initialized: bool,
    pub device_name: String,
    pub sample_rate: u32,
    pub output_channels: u16,
    pub playing: bool,
    pub position_seconds: f64,
    pub duration_seconds: f64,
    pub peak_left: f32,
    pub peak_right: f32,
    pub device_error: bool,
    pub loaded_tracks: usize,
    pub count_in_active: bool,
    pub count_in_beat: u64,
    pub count_in_total: u64,
}

impl AudioEngine {
    pub fn new() -> Result<Self, AudioError> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or(AudioError::NoOutputDevice)?;

        let device_name = device
            .description()
            .map(|description| description.name().to_owned())
            .unwrap_or_else(|_| device.to_string());

        let supported = device
            .default_output_config()
            .map_err(|error| AudioError::Device(error.to_string()))?;

        let sample_rate = supported.sample_rate().0;
        let output_channels = supported.channels();
        let sample_format = supported.sample_format();
        let config = supported.config();

        let realtime = Arc::new(RealtimeState::new());
        let error_state = realtime.clone();

        let stream = match sample_format {
            SampleFormat::F32 => build_stream::<f32>(&device, &config, realtime.clone(), error_state)?,
            SampleFormat::I16 => build_stream::<i16>(&device, &config, realtime.clone(), error_state)?,
            SampleFormat::U16 => build_stream::<u16>(&device, &config, realtime.clone(), error_state)?,
            format => {
                return Err(AudioError::Stream(format!(
                    "unsupported output sample format {format}"
                )))
            }
        };

        stream
            .play()
            .map_err(|error| AudioError::Stream(error.to_string()))?;

        Ok(Self {
            realtime,
            _stream: stream,
            device_name,
            sample_rate,
            output_channels,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn replace_song(&self, mix: SongMix) {
        self.realtime.transition.cancel();
        self.realtime.transport.pause();
        self.realtime.transport.seek_frame(0);
        self.realtime.mix.store(Arc::new(mix));
        self.realtime.meter.store_peaks(0.0, 0.0);
    }

    pub fn play(&self) {
        self.realtime.transition.cancel();
        let mix = self.realtime.mix.load();
        if mix.duration_frames == 0 {
            return;
        }

        if self.realtime.transport.frame() >= mix.duration_frames {
            self.realtime.transport.seek_frame(0);
        }

        self.realtime.transport.play();
    }

    pub fn pause(&self) {
        self.realtime.transition.cancel();
        self.realtime.transport.pause();
    }

    pub fn stop(&self) {
        self.realtime.transition.cancel();
        self.realtime.transport.stop();
        self.realtime.meter.store_peaks(0.0, 0.0);
    }

    pub fn seek_seconds(&self, seconds: f64) {
        self.realtime.transition.cancel();
        let mix = self.realtime.mix.load();
        let requested = (seconds.max(0.0) * self.sample_rate as f64).round() as u64;
        let frame = requested.min(mix.duration_frames);
        self.realtime.transport.seek_frame(frame);
    }

    pub fn schedule_transition_seconds(
        &self,
        target_seconds: f64,
        delay_seconds: f64,
        first_count_delay_seconds: f64,
        beat_seconds: f64,
        count_beats: u64,
        keep_audio: bool,
    ) {
        let mix = self.realtime.mix.load();
        let target_frame = seconds_to_frame(
            target_seconds.max(0.0),
            self.sample_rate,
        )
        .min(mix.duration_frames);
        let total_frames = seconds_to_frame(delay_seconds.max(0.0), self.sample_rate);
        let first_count_delay_frames =
            seconds_to_frame(first_count_delay_seconds.max(0.0), self.sample_rate);
        let beat_frames = seconds_to_frame(beat_seconds.max(0.0), self.sample_rate);

        self.realtime.transition.schedule(
            target_frame,
            total_frames,
            first_count_delay_frames,
            beat_frames,
            count_beats,
            keep_audio,
        );
    }

    pub fn cancel_transition(&self) {
        self.realtime.transition.cancel();
    }

    pub fn set_loop_seconds(&self, start_seconds: f64, end_seconds: f64) {
        let start = (start_seconds.max(0.0) * self.sample_rate as f64).round() as u64;
        let end = (end_seconds.max(0.0) * self.sample_rate as f64).round() as u64;
        self.realtime.transport.set_loop(start, end);
    }

    pub fn clear_loop(&self) {
        self.realtime.transport.clear_loop();
    }

    pub fn set_track_gain_db(&self, id: &str, gain_db: f32) -> Result<(), AudioError> {
        let mix = self.realtime.mix.load();
        let track = mix
            .track(id)
            .ok_or_else(|| AudioError::TrackNotFound(id.to_owned()))?;
        track.control.set_gain_db(gain_db);
        Ok(())
    }

    pub fn set_track_muted(&self, id: &str, muted: bool) -> Result<(), AudioError> {
        let mix = self.realtime.mix.load();
        let track = mix
            .track(id)
            .ok_or_else(|| AudioError::TrackNotFound(id.to_owned()))?;
        track.control.set_muted(muted);
        Ok(())
    }

    pub fn set_track_solo(&self, id: &str, solo: bool) -> Result<(), AudioError> {
        let mix = self.realtime.mix.load();
        let track = mix
            .track(id)
            .ok_or_else(|| AudioError::TrackNotFound(id.to_owned()))?;
        track.control.set_solo(solo);
        Ok(())
    }

    pub fn status(&self) -> AudioEngineStatus {
        let mix = self.realtime.mix.load();
        let (peak_left, peak_right) = self.realtime.meter.peaks();
        let frame = self.realtime.transport.frame();

        let (count_in_beat, count_in_total) = self
            .realtime
            .transition
            .current_count_beat()
            .unwrap_or((0, 0));

        AudioEngineStatus {
            initialized: true,
            device_name: self.device_name.clone(),
            sample_rate: self.sample_rate,
            output_channels: self.output_channels,
            playing: self.realtime.transport.is_playing(),
            position_seconds: frame as f64 / self.sample_rate as f64,
            duration_seconds: mix.duration_frames as f64 / self.sample_rate as f64,
            peak_left,
            peak_right,
            device_error: self.realtime.device_error.load(Ordering::Acquire),
            loaded_tracks: mix.tracks.len(),
            count_in_active: self.realtime.transition.active(),
            count_in_beat,
            count_in_total,
        }
    }
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    realtime: Arc<RealtimeState>,
    error_state: Arc<RealtimeState>,
) -> Result<Stream, AudioError>
where
    T: SizedSample + Sample + FromSample<f32>,
{
    let channels = config.channels as usize;
    let sample_rate = config.sample_rate.0;

    device
        .build_output_stream(
            config.clone(),
            move |output: &mut [T], _| {
                render(output, channels, sample_rate, &realtime)
            },
            move |_error| {
                error_state.device_error.store(true, Ordering::Release);
            },
            None,
        )
        .map_err(|error| AudioError::Stream(error.to_string()))
}

fn render<T>(
    output: &mut [T],
    output_channels: usize,
    sample_rate: u32,
    realtime: &RealtimeState,
)
where
    T: SizedSample + Sample + FromSample<f32>,
{
    for sample in output.iter_mut() {
        *sample = T::EQUILIBRIUM;
    }

    if output_channels == 0 {
        realtime.meter.store_peaks(0.0, 0.0);
        return;
    }

    let mix = realtime.mix.load();
    if mix.duration_frames == 0 {
        realtime.transition.cancel();
        realtime.transport.pause();
        realtime.meter.store_peaks(0.0, 0.0);
        return;
    }

    let has_solo = mix.tracks.iter().any(|track| track.control.solo());
    let transition = realtime.transition.snapshot();
    let mut transition_active = transition.active;
    let mut transition_remaining = transition.remaining_frames;
    let mut playhead = realtime.transport.frame();
    let mut playing = realtime.transport.is_playing();
    let mut peak_left = 0.0_f32;
    let mut peak_right = 0.0_f32;

    if !playing && !transition_active {
        realtime.meter.store_peaks(0.0, 0.0);
        return;
    }

    for frame_out in output.chunks_mut(output_channels) {
        if transition_active && transition_remaining == 0 {
            playhead = transition.target_frame;
            realtime.transport.seek_frame(playhead);
            realtime.transport.play();
            playing = true;
            transition_active = false;
            realtime.transition.complete();
        }

        let mut left = 0.0_f32;
        let mut right = 0.0_f32;

        let should_render_song =
            playing && (!transition_active || transition.keep_audio);

        if should_render_song {
            if let Some(timeline_frame) =
                realtime.transport.normalize_frame(playhead, mix.duration_frames)
            {
                for track in &mix.tracks {
                    if track.control.muted() || (has_solo && !track.control.solo()) {
                        continue;
                    }

                    let (track_left, track_right) = track.sample_at(timeline_frame);
                    let gain = track.control.gain_linear();

                    left += track_left * gain;
                    right += track_right * gain;
                }

                playhead = timeline_frame.saturating_add(1);
            } else if transition_active {
                playing = false;
                realtime.transport.pause();
            } else {
                realtime.transport.pause();
                playing = false;
            }
        }

        if transition_active {
            let elapsed = transition
                .total_frames
                .saturating_sub(transition_remaining);
            let click = count_click_sample(elapsed, transition, sample_rate);
            left += click;
            right += click;

            transition_remaining = transition_remaining.saturating_sub(1);
        }

        left = left.clamp(-1.0, 1.0);
        right = right.clamp(-1.0, 1.0);

        peak_left = peak_left.max(left.abs());
        peak_right = peak_right.max(right.abs());

        if output_channels == 1 {
            frame_out[0] = T::from_sample_((left + right) * 0.5);
        } else {
            frame_out[0] = T::from_sample_(left);
            frame_out[1] = T::from_sample_(right);
        }
    }

    realtime.transport.seek_frame(playhead);

    if transition_active {
        realtime
            .transition
            .store_remaining(transition_remaining);
    }

    realtime.meter.store_peaks(peak_left, peak_right);
}

fn count_click_sample(
    elapsed_frames: u64,
    transition: super::transition::TransitionSnapshot,
    sample_rate: u32,
) -> f32 {
    if transition.count_beats == 0 || transition.beat_frames == 0 {
        return 0.0;
    }

    if elapsed_frames < transition.first_count_delay_frames {
        return 0.0;
    }

    let counted = elapsed_frames - transition.first_count_delay_frames;
    let beat_index = counted / transition.beat_frames;
    if beat_index >= transition.count_beats {
        return 0.0;
    }

    let offset = counted % transition.beat_frames;
    let click_frames = (sample_rate as u64 / 32).max(1);
    if offset >= click_frames {
        return 0.0;
    }

    let accent = beat_index == 0;
    let frequency = if accent { 1_650.0_f32 } else { 1_050.0_f32 };
    let gain = if accent { 0.34_f32 } else { 0.24_f32 };
    let phase = std::f32::consts::TAU
        * frequency
        * (offset as f32 / sample_rate.max(1) as f32);
    let envelope = 1.0 - (offset as f32 / click_frames as f32);

    phase.sin() * envelope * gain
}

fn seconds_to_frame(seconds: f64, sample_rate: u32) -> u64 {
    (seconds * sample_rate as f64).round() as u64
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::audio::model::{PcmTrack, TrackControl};

    fn test_state(samples: Vec<f32>) -> RealtimeState {
        let state = RealtimeState::new();
        state.mix.store(Arc::new(SongMix::new(vec![PcmTrack {
            id: "test".into(),
            name: "Test".into(),
            samples: Arc::from(samples),
            start_frame: 0,
            control: Arc::new(TrackControl::new(0.0)),
        }])));
        state.transport.play();
        state
    }

    #[test]
    fn render_advances_sample_accurately() {
        let state = test_state(vec![0.25, -0.25, 0.5, -0.5]);
        let mut output = vec![0.0_f32; 4];

        render(&mut output, 2, 48_000, &state);

        assert_eq!(output, vec![0.25, -0.25, 0.5, -0.5]);
        assert_eq!(state.transport.frame(), 2);
    }

    #[test]
    fn scheduled_preroll_starts_song_on_the_target_frame() {
        let state = test_state(vec![
            0.1, 0.1,
            0.2, 0.2,
            0.3, 0.3,
            0.4, 0.4,
        ]);
        state.transport.pause();
        state.transport.seek_frame(0);
        state.transition.schedule(2, 2, 0, 1, 2, false);

        let mut output = vec![0.0_f32; 6];
        render(&mut output, 2, 48_000, &state);

        assert!(!state.transition.active());
        assert!(state.transport.is_playing());
        assert_eq!(state.transport.frame(), 3);
        assert_eq!(output[4], 0.2);
        assert_eq!(output[5], 0.2);
    }

    #[test]
    fn solo_excludes_non_solo_tracks() {
        let state = RealtimeState::new();

        let solo = Arc::new(TrackControl::new(0.0));
        solo.set_solo(true);

        state.mix.store(Arc::new(SongMix::new(vec![
            PcmTrack {
                id: "solo".into(),
                name: "Solo".into(),
                samples: Arc::from(vec![0.2, 0.2]),
                start_frame: 0,
                control: solo,
            },
            PcmTrack {
                id: "other".into(),
                name: "Other".into(),
                samples: Arc::from(vec![0.8, 0.8]),
                start_frame: 0,
                control: Arc::new(TrackControl::new(0.0)),
            },
        ])));
        state.transport.play();

        let mut output = vec![0.0_f32; 2];
        render(&mut output, 2, 48_000, &state);

        assert_eq!(output, vec![0.2, 0.2]);
    }
}
