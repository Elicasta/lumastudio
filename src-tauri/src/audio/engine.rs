use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
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
    bus::BusControl,
    error::AudioError,
    guide::{
        prepare_timeline, prepare_transition, GuideRenderer, GuideSchedule,
        GuideTimelineEventRequest, GuideTransitionEventRequest, VoicePack,
        VoicePackInfo,
    },
    meter::StereoMeter,
    model::{SongMix, TrackBus},
    pad::{render_pad, PadSample, PadVoice},
    transition::ScheduledTransition,
    transport::Transport,
};

pub struct RealtimeState {
    pub mix: ArcSwap<SongMix>,
    pub transport: Transport,
    pub meter: StereoMeter,
    pub transition: ScheduledTransition,
    pub voice_pack: ArcSwap<VoicePack>,
    pub guide_timeline: ArcSwap<GuideSchedule>,
    pub transition_guide: ArcSwap<GuideSchedule>,
    pub guide_revision: AtomicU64,
    pub music_bus: BusControl,
    pub click_bus: BusControl,
    pub guide_bus: BusControl,
    pub master_bus: BusControl,
    pub pad_bus: BusControl,
    pub pads: Vec<PadVoice>,
    pub device_error: AtomicBool,
}

impl RealtimeState {
    fn new() -> Self {
        Self {
            mix: ArcSwap::from_pointee(SongMix::empty()),
            transport: Transport::new(),
            meter: StereoMeter::new(),
            transition: ScheduledTransition::new(),
            voice_pack: ArcSwap::from_pointee(VoicePack::empty()),
            guide_timeline: ArcSwap::from_pointee(GuideSchedule::empty()),
            transition_guide: ArcSwap::from_pointee(GuideSchedule::empty()),
            guide_revision: AtomicU64::new(1),
            music_bus: BusControl::new(0.0),
            click_bus: BusControl::new(-6.0),
            guide_bus: BusControl::new(-3.0),
            master_bus: BusControl::new(0.0),
            pad_bus: BusControl::new(0.0),
            pads: (0..16).map(|_| PadVoice::new()).collect(),
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
pub struct AudioBusStatus {
    pub gain_db: f32,
    pub muted: bool,
    pub output_left: u16,
    pub output_right: u16,
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
    pub transition_active: bool,
    pub count_in_active: bool,
    pub count_in_beat: u64,
    pub count_in_total: u64,
    pub count_in_bar: u64,
    pub count_in_bars: u64,
    pub voice_pack: Option<VoicePackInfo>,
    pub music_bus: AudioBusStatus,
    pub click_bus: AudioBusStatus,
    pub guide_bus: AudioBusStatus,
    pub master_bus: AudioBusStatus,
    pub pad_bus: AudioBusStatus,
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

        let sample_rate = supported.sample_rate();
        let output_channels = supported.channels();
        let sample_format = supported.sample_format();
        let config = supported.config();

        let realtime = Arc::new(RealtimeState::new());
        if output_channels == 1 {
            realtime.music_bus.set_output_pair(0, 0);
            realtime.click_bus.set_output_pair(0, 0);
            realtime.guide_bus.set_output_pair(0, 0);
            realtime.master_bus.set_output_pair(0, 0);
            realtime.pad_bus.set_output_pair(0, 0);
        }
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

    pub fn load_pad(&self, index: usize, sample: PadSample) -> Result<(), AudioError> {
        let voice = self.realtime.pads.get(index).ok_or_else(|| AudioError::Guide("pad index is outside 1-16".into()))?;
        voice.sample.store(Arc::new(sample));
        voice.stop();
        Ok(())
    }

    pub fn trigger_pad(&self, index: usize) -> Result<(), AudioError> {
        self.realtime.pads.get(index).ok_or_else(|| AudioError::Guide("pad index is outside 1-16".into()))?.trigger();
        Ok(())
    }

    pub fn release_pad(&self, index: usize) -> Result<(), AudioError> { self.realtime.pads.get(index).ok_or_else(|| AudioError::Guide("pad index is outside 1-16".into()))?.release(); Ok(()) }

    pub fn stop_pad(&self, index: usize) -> Result<(), AudioError> {
        self.realtime.pads.get(index).ok_or_else(|| AudioError::Guide("pad index is outside 1-16".into()))?.stop();
        Ok(())
    }

    pub fn configure_pad(&self, index: usize, gain_db: f32, width: f32, attack_ms: u64, release_ms: u64) -> Result<(), AudioError> {
        let voice = self.realtime.pads.get(index).ok_or_else(|| AudioError::Guide("pad index is outside 1-16".into()))?;
        voice.gain.store(if gain_db <= -90.0 { 0.0 } else { 10.0_f32.powf(gain_db.clamp(-90.0, 12.0) / 20.0) });
        voice.width.store(width.clamp(0.0, 2.0));
        voice.attack_frames.store((attack_ms as f64 * self.sample_rate as f64 / 1000.0) as u64, Ordering::Relaxed);
        voice.release_frames.store((release_ms as f64 * self.sample_rate as f64 / 1000.0) as u64, Ordering::Relaxed);
        Ok(())
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn replace_song(&self, mix: SongMix) {
        self.realtime.transition.cancel();
        self.clear_transition_guide();
        self.realtime.transport.pause();
        self.realtime.transport.seek_frame(0);
        self.realtime.mix.store(Arc::new(mix));
        self.realtime.meter.store_peaks(0.0, 0.0);
    }

    pub fn replace_voice_pack(&self, pack: VoicePack) {
        self.realtime.voice_pack.store(Arc::new(pack));
        self.clear_guide_timeline();
        self.clear_transition_guide();
    }

    pub fn set_guide_timeline(
        &self,
        requests: &[GuideTimelineEventRequest],
    ) -> Result<(), AudioError> {
        let revision = self.next_guide_revision();
        let pack = self.realtime.voice_pack.load();
        let schedule = if requests.is_empty() {
            GuideSchedule {
                revision,
                events: Vec::new(),
            }
        } else if pack.loaded() {
            prepare_timeline(requests, &**pack, self.sample_rate, revision)?
        } else {
            GuideSchedule {
                revision,
                events: Vec::new(),
            }
        };

        self.realtime.guide_timeline.store(Arc::new(schedule));
        Ok(())
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
        pulses_per_bar: u64,
        click_enabled: bool,
        keep_audio: bool,
        guide_events: &[GuideTransitionEventRequest],
    ) -> Result<(), AudioError> {
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
        let revision = self.next_guide_revision();
        let pack = self.realtime.voice_pack.load();
        let guide_schedule = if guide_events.is_empty() {
            GuideSchedule {
                revision,
                events: Vec::new(),
            }
        } else if pack.loaded() {
            prepare_transition(
                guide_events,
                &**pack,
                total_frames,
                beat_frames,
                revision,
            )?
        } else {
            GuideSchedule {
                revision,
                events: Vec::new(),
            }
        };

        self.realtime
            .transition_guide
            .store(Arc::new(guide_schedule));

        self.realtime.transition.schedule(
            target_frame,
            total_frames,
            first_count_delay_frames,
            beat_frames,
            count_beats,
            pulses_per_bar,
            click_enabled,
            keep_audio,
        );

        Ok(())
    }

    pub fn cancel_transition(&self) {
        self.realtime.transition.cancel();
        self.clear_transition_guide();
    }

    pub fn set_bus_gain_db(&self, id: &str, gain_db: f32) -> Result<(), AudioError> {
        self.bus(id)?.set_gain_db(gain_db);
        Ok(())
    }

    pub fn set_bus_muted(&self, id: &str, muted: bool) -> Result<(), AudioError> {
        self.bus(id)?.set_muted(muted);
        Ok(())
    }

    pub fn set_bus_route(
        &self,
        id: &str,
        output_left: u16,
        output_right: u16,
    ) -> Result<(), AudioError> {
        if id == "master" {
            return Err(AudioError::Guide(
                "Master is a global gain stage and does not own a hardware route".into(),
            ));
        }

        if output_left == 0
            || output_right == 0
            || output_left > self.output_channels
            || output_right > self.output_channels
        {
            return Err(AudioError::Guide(format!(
                "output route {output_left}-{output_right} is outside the active {}-channel device",
                self.output_channels
            )));
        }

        self.bus(id)?
            .set_output_pair(output_left - 1, output_right - 1);
        Ok(())
    }

    fn bus(&self, id: &str) -> Result<&BusControl, AudioError> {
        match id {
            "music" => Ok(&self.realtime.music_bus),
            "click" => Ok(&self.realtime.click_bus),
            "guide" => Ok(&self.realtime.guide_bus),
            "pads" => Ok(&self.realtime.pad_bus),
            "master" => Ok(&self.realtime.master_bus),
            _ => Err(AudioError::BusNotFound(id.to_owned())),
        }
    }

    fn next_guide_revision(&self) -> u64 {
        self.realtime
            .guide_revision
            .fetch_add(1, Ordering::AcqRel)
            .saturating_add(1)
    }

    fn clear_guide_timeline(&self) {
        let revision = self.next_guide_revision();
        self.realtime.guide_timeline.store(Arc::new(GuideSchedule {
            revision,
            events: Vec::new(),
        }));
    }

    fn clear_transition_guide(&self) {
        let revision = self.next_guide_revision();
        self.realtime.transition_guide.store(Arc::new(GuideSchedule {
            revision,
            events: Vec::new(),
        }));
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

        let (count_in_beat, count_in_total, count_in_bar, count_in_bars) = self
            .realtime
            .transition
            .current_count_position()
            .unwrap_or((0, 0, 0, 0));

        let voice_pack = self.realtime.voice_pack.load();

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
            transition_active: self.realtime.transition.active(),
            count_in_active: self.realtime.transition.active() && count_in_total > 0,
            count_in_beat,
            count_in_total,
            count_in_bar,
            count_in_bars,
            voice_pack: VoicePackInfo::from_pack(&**voice_pack),
            music_bus: AudioBusStatus {
                gain_db: self.realtime.music_bus.gain_db(),
                muted: self.realtime.music_bus.muted(),
                output_left: self.realtime.music_bus.output_pair().0 + 1,
                output_right: self.realtime.music_bus.output_pair().1 + 1,
            },
            click_bus: AudioBusStatus {
                gain_db: self.realtime.click_bus.gain_db(),
                muted: self.realtime.click_bus.muted(),
                output_left: self.realtime.click_bus.output_pair().0 + 1,
                output_right: self.realtime.click_bus.output_pair().1 + 1,
            },
            guide_bus: AudioBusStatus {
                gain_db: self.realtime.guide_bus.gain_db(),
                muted: self.realtime.guide_bus.muted(),
                output_left: self.realtime.guide_bus.output_pair().0 + 1,
                output_right: self.realtime.guide_bus.output_pair().1 + 1,
            },
            master_bus: AudioBusStatus {
                gain_db: self.realtime.master_bus.gain_db(),
                muted: self.realtime.master_bus.muted(),
                output_left: self.realtime.master_bus.output_pair().0 + 1,
                output_right: self.realtime.master_bus.output_pair().1 + 1,
            },
            pad_bus: AudioBusStatus {
                gain_db: self.realtime.pad_bus.gain_db(),
                muted: self.realtime.pad_bus.muted(),
                output_left: self.realtime.pad_bus.output_pair().0 + 1,
                output_right: self.realtime.pad_bus.output_pair().1 + 1,
            },
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
    let sample_rate = config.sample_rate;
    let mut guide_renderer = GuideRenderer::default();

    device
        .build_output_stream(
            config.clone(),
            move |output: &mut [T], _| {
                render(
                    output,
                    channels,
                    sample_rate,
                    &realtime,
                    &mut guide_renderer,
                )
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
    guide_renderer: &mut GuideRenderer,
)
where
    T: SizedSample + Sample + FromSample<f32>,
{
    for sample in output.iter_mut() {
        *sample = T::EQUILIBRIUM;
    }

    if output_channels == 0 {
        realtime.meter.store_peaks(0.0, 0.0);
        guide_renderer.clear();
        return;
    }

    let mix = realtime.mix.load();
    let pads_active = realtime.pads.iter().any(|voice| voice.playing.load(Ordering::Acquire));
    if mix.duration_frames == 0 && !pads_active {
        realtime.transition.cancel();
        realtime.transport.pause();
        realtime.meter.store_peaks(0.0, 0.0);
        guide_renderer.clear();
        return;
    }

    let timeline = realtime.guide_timeline.load();
    let transition_guide = realtime.transition_guide.load();
    let has_solo = mix.tracks.iter().any(|track| track.control.solo());
    let transition = realtime.transition.snapshot();
    let mut transition_active = transition.active;
    let mut transition_remaining = transition.remaining_frames;
    let mut playhead = realtime.transport.frame();
    let mut playing = realtime.transport.is_playing();
    let mut peak_left = 0.0_f32;
    let mut peak_right = 0.0_f32;

    guide_renderer.begin_buffer(
        &timeline,
        &transition_guide,
        playhead,
        transition_active,
    );

    if !playing && !transition_active && !pads_active {
        realtime.meter.store_peaks(0.0, 0.0);
        guide_renderer.clear();
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
            guide_renderer.seek_timeline(&timeline, playhead);
        }

        let mut click = 0.0_f32;

        if transition_active {
            let elapsed = transition
                .total_frames
                .saturating_sub(transition_remaining);
            guide_renderer.trigger_transition(elapsed, &transition_guide);
            click = count_click_sample(elapsed, transition, sample_rate);
        } else if playing {
            guide_renderer.trigger_timeline(playhead, &timeline);
        }

        let mut music_left = 0.0_f32;
        let mut music_right = 0.0_f32;
        let mut track_click_left = 0.0_f32;
        let mut track_click_right = 0.0_f32;
        let mut track_guide_left = 0.0_f32;
        let mut track_guide_right = 0.0_f32;
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

                    match track.bus {
                        TrackBus::Music => {
                            music_left += track_left * gain;
                            music_right += track_right * gain;
                        }
                        TrackBus::Click => {
                            track_click_left += track_left * gain;
                            track_click_right += track_right * gain;
                        }
                        TrackBus::Guide => {
                            track_guide_left += track_left * gain;
                            track_guide_right += track_right * gain;
                        }
                    }
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

        let (voice_guide_left, voice_guide_right) = guide_renderer.mix_active();

        let mut pad_left = 0.0_f32;
        let mut pad_right = 0.0_f32;
        for voice in &realtime.pads {
            let (left, right) = render_pad(voice);
            pad_left += left;
            pad_right += right;
        }

        let music_gain = realtime.music_bus.gain_linear();
        let click_gain = realtime.click_bus.gain_linear();
        let guide_gain = realtime.guide_bus.gain_linear();
        let pad_gain = realtime.pad_bus.gain_linear();
        let master_gain = realtime.master_bus.gain_linear();

        let music = (music_left * music_gain, music_right * music_gain);
        let click_bus = (
            (track_click_left + click) * click_gain,
            (track_click_right + click) * click_gain,
        );
        let guide = (
            (track_guide_left + voice_guide_left) * guide_gain,
            (track_guide_right + voice_guide_right) * guide_gain,
        );
        let pads = (pad_left * pad_gain, pad_right * pad_gain);

        let music_route = realtime.music_bus.output_pair();
        let click_route = realtime.click_bus.output_pair();
        let guide_route = realtime.guide_bus.output_pair();
        let pad_route = realtime.pad_bus.output_pair();

        for (channel, sample_out) in frame_out.iter_mut().enumerate() {
            let channel = channel as u16;
            let sample = (
                routed_bus_sample(channel, music_route, music)
                    + routed_bus_sample(channel, click_route, click_bus)
                    + routed_bus_sample(channel, guide_route, guide)
                    + routed_bus_sample(channel, pad_route, pads)
            ) * master_gain;
            let sample = sample.clamp(-1.0, 1.0);

            if channel == 0 {
                peak_left = peak_left.max(sample.abs());
            }
            if channel == 1 || (output_channels == 1 && channel == 0) {
                peak_right = peak_right.max(sample.abs());
            }

            *sample_out = T::from_sample_(sample);
        }

        if transition_active {
            transition_remaining = transition_remaining.saturating_sub(1);
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

fn routed_bus_sample(
    channel: u16,
    route: (u16, u16),
    signal: (f32, f32),
) -> f32 {
    let (left_channel, right_channel) = route;
    let (left, right) = signal;

    if left_channel == right_channel {
        if channel == left_channel {
            return (left + right) * 0.5;
        }
        return 0.0;
    }

    let mut sample = 0.0;
    if channel == left_channel {
        sample += left;
    }
    if channel == right_channel {
        sample += right;
    }
    sample
}

fn count_click_sample(
    elapsed_frames: u64,
    transition: super::transition::TransitionSnapshot,
    sample_rate: u32,
) -> f32 {
    if !transition.click_enabled
        || transition.count_beats == 0
        || transition.beat_frames == 0
    {
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

    let pulses = transition.pulses_per_bar.max(1);
    let remainder = transition.count_beats % pulses;
    let first_beat = if remainder == 0 {
        1
    } else {
        pulses - remainder + 1
    };
    let beat_number = ((first_beat - 1 + beat_index) % pulses) + 1;
    let accent = beat_number == 1;
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
            bus: TrackBus::Music,
            control: Arc::new(TrackControl::new(0.0)),
        }])));
        state.transport.play();
        state
    }

    #[test]
    fn render_advances_sample_accurately() {
        let state = test_state(vec![0.25, -0.25, 0.5, -0.5]);
        let mut output = vec![0.0_f32; 4];

        render(&mut output, 2, 48_000, &state, &mut GuideRenderer::default());

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
        state.transition.schedule(2, 2, 0, 1, 2, 4, true, false);

        let mut output = vec![0.0_f32; 6];
        render(&mut output, 2, 48_000, &state, &mut GuideRenderer::default());

        assert!(!state.transition.active());
        assert!(state.transport.is_playing());
        assert_eq!(state.transport.frame(), 3);
        assert_eq!(output[4], 0.3);
        assert_eq!(output[5], 0.3);
    }

    #[test]
    fn routes_guide_bus_to_independent_hardware_channels() {
        let state = RealtimeState::new();
        state.guide_bus.set_gain_db(0.0);
        state.guide_bus.set_output_pair(2, 3);

        state.mix.store(Arc::new(SongMix::new(vec![
            PcmTrack {
                id: "music".into(),
                name: "Music".into(),
                samples: Arc::from(vec![0.2, 0.3]),
                start_frame: 0,
                bus: TrackBus::Music,
                control: Arc::new(TrackControl::new(0.0)),
            },
            PcmTrack {
                id: "guide".into(),
                name: "Guide".into(),
                samples: Arc::from(vec![0.6, 0.7]),
                start_frame: 0,
                bus: TrackBus::Guide,
                control: Arc::new(TrackControl::new(0.0)),
            },
        ])));
        state.transport.play();

        let mut output = vec![0.0_f32; 4];
        render(
            &mut output,
            4,
            48_000,
            &state,
            &mut GuideRenderer::default(),
        );

        assert_eq!(output, vec![0.2, 0.3, 0.6, 0.7]);
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
                bus: TrackBus::Music,
                control: solo,
            },
            PcmTrack {
                id: "other".into(),
                name: "Other".into(),
                samples: Arc::from(vec![0.8, 0.8]),
                start_frame: 0,
                bus: TrackBus::Music,
                control: Arc::new(TrackControl::new(0.0)),
            },
        ])));
        state.transport.play();

        let mut output = vec![0.0_f32; 2];
        render(&mut output, 2, 48_000, &state, &mut GuideRenderer::default());

        assert_eq!(output, vec![0.2, 0.2]);
    }
}

#[cfg(test)]
mod pad_engine_tests {
    use super::*;

    #[test]
    fn realtime_state_has_sixteen_pad_voices() {
        let state = RealtimeState::new();
        assert_eq!(state.pads.len(), 16);
    }

    #[test]
    fn pads_bus_is_addressable() {
        let state = RealtimeState::new();
        assert_eq!(state.pad_bus.output_pair(), (0, 1));
    }
}
