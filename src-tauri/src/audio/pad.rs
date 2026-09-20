use std::sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Arc};
use arc_swap::ArcSwap;
use super::model::AtomicF32;

#[derive(Clone)]
pub struct PadSample {
    pub id: String,
    pub samples: Arc<[f32]>,
    pub looped: bool,
    pub gain: f32,
    pub width: f32,
    pub playback_rate: f32,
}

impl PadSample {
    pub fn empty() -> Self { Self { id: String::new(), samples: Arc::from([]), looped: false, gain: 1.0, width: 1.0, playback_rate: 1.0 } }
    pub fn frames(&self) -> u64 { (self.samples.len() / 2) as u64 }
}

pub struct PadVoice {
    pub sample: ArcSwap<PadSample>,
    pub playing: AtomicBool,
    pub frame_bits: AtomicU64,
    pub gain: AtomicF32,
    pub width: AtomicF32,
    pub attack_frames: AtomicU64,
    pub release_frames: AtomicU64,
    pub releasing: AtomicBool,
}

impl PadVoice {
    pub fn new() -> Self {
        Self { sample: ArcSwap::from_pointee(PadSample::empty()), playing: AtomicBool::new(false), frame_bits: AtomicU64::new(0f64.to_bits()), gain: AtomicF32::new(1.0), width: AtomicF32::new(1.0), attack_frames: AtomicU64::new(0), release_frames: AtomicU64::new(0), releasing: AtomicBool::new(false) }
    }
    pub fn trigger(&self) { self.frame_bits.store(0f64.to_bits(), Ordering::Release); self.releasing.store(false, Ordering::Release); self.playing.store(true, Ordering::Release); }
    pub fn release(&self) { self.releasing.store(true, Ordering::Release); }
    pub fn stop(&self) { self.playing.store(false, Ordering::Release); }
    pub fn position(&self) -> f64 { f64::from_bits(self.frame_bits.load(Ordering::Relaxed)) }
    pub fn set_position(&self, value: f64) { self.frame_bits.store(value.to_bits(), Ordering::Relaxed); }
}

pub fn render_pad(voice: &PadVoice) -> (f32, f32) {
    if !voice.playing.load(Ordering::Acquire) { return (0.0, 0.0); }
    let sample = voice.sample.load();
    let frames = sample.frames();
    if frames == 0 { voice.stop(); return (0.0, 0.0); }
    let mut pos = voice.position();
    if pos >= frames as f64 {
        if sample.looped { pos %= frames as f64; } else { voice.stop(); return (0.0, 0.0); }
    }
    let frame = pos.floor() as usize;
    let next = if frame + 1 < frames as usize { frame + 1 } else if sample.looped { 0 } else { frame };
    let frac = (pos - frame as f64) as f32;
    let l = sample.samples[frame * 2] * (1.0 - frac) + sample.samples[next * 2] * frac;
    let r = sample.samples[frame * 2 + 1] * (1.0 - frac) + sample.samples[next * 2 + 1] * frac;
    let mid = (l + r) * 0.5;
    let width = voice.width.load().clamp(0.0, 2.0);
    let attack = voice.attack_frames.load(Ordering::Relaxed);
    let release = voice.release_frames.load(Ordering::Relaxed);
    let frame_pos = pos as u64;
    let attack_env = if attack > 0 { (frame_pos as f32 / attack as f32).clamp(0.0, 1.0) } else { 1.0 };
    let release_env = if voice.releasing.load(Ordering::Acquire) {
        if release == 0 { voice.stop(); return (0.0, 0.0); }
        let remaining = frames.saturating_sub(frame_pos);
        let env = (remaining as f32 / release as f32).clamp(0.0, 1.0);
        if env <= 0.0001 { voice.stop(); }
        env
    } else { 1.0 };
    let gain = voice.gain.load() * attack_env * release_env;
    voice.set_position(pos + sample.playback_rate.max(0.125) as f64);
    ((mid + (l - mid) * width) * gain, (mid + (r - mid) * width) * gain)
}
