use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc,
};

#[derive(Debug)]
pub struct AtomicF32(AtomicU32);

impl AtomicF32 {
    pub fn new(value: f32) -> Self {
        Self(AtomicU32::new(value.to_bits()))
    }

    pub fn load(&self) -> f32 {
        f32::from_bits(self.0.load(Ordering::Relaxed))
    }

    pub fn store(&self, value: f32) {
        self.0.store(value.to_bits(), Ordering::Relaxed);
    }
}

#[derive(Debug)]
pub struct TrackControl {
    gain_linear: AtomicF32,
    muted: AtomicBool,
    solo: AtomicBool,
}

impl TrackControl {
    pub fn new(gain_db: f32) -> Self {
        Self {
            gain_linear: AtomicF32::new(db_to_linear(gain_db)),
            muted: AtomicBool::new(false),
            solo: AtomicBool::new(false),
        }
    }

    pub fn gain_linear(&self) -> f32 {
        self.gain_linear.load()
    }

    pub fn set_gain_db(&self, gain_db: f32) {
        self.gain_linear.store(db_to_linear(gain_db.clamp(-90.0, 12.0)));
    }

    pub fn muted(&self) -> bool {
        self.muted.load(Ordering::Relaxed)
    }

    pub fn set_muted(&self, muted: bool) {
        self.muted.store(muted, Ordering::Relaxed);
    }

    pub fn solo(&self) -> bool {
        self.solo.load(Ordering::Relaxed)
    }

    pub fn set_solo(&self, solo: bool) {
        self.solo.store(solo, Ordering::Relaxed);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackBus {
    Music,
    Click,
    Guide,
}

impl TrackBus {
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "music" => Some(Self::Music),
            "click" => Some(Self::Click),
            "guide" => Some(Self::Guide),
            _ => None,
        }
    }
}

#[derive(Clone)]
pub struct PcmTrack {
    pub id: String,
    pub name: String,
    pub samples: Arc<[f32]>,
    pub start_frame: u64,
    pub bus: TrackBus,
    pub control: Arc<TrackControl>,
}

impl PcmTrack {
    pub fn stereo_frame_count(&self) -> u64 {
        (self.samples.len() / 2) as u64
    }

    pub fn end_frame(&self) -> u64 {
        self.start_frame.saturating_add(self.stereo_frame_count())
    }

    #[inline]
    pub fn sample_at(&self, timeline_frame: u64) -> (f32, f32) {
        if timeline_frame < self.start_frame {
            return (0.0, 0.0);
        }

        let local = timeline_frame - self.start_frame;
        if local >= self.stereo_frame_count() {
            return (0.0, 0.0);
        }

        let index = local as usize * 2;
        (self.samples[index], self.samples[index + 1])
    }
}

pub struct SongMix {
    pub tracks: Vec<PcmTrack>,
    pub duration_frames: u64,
}

impl SongMix {
    pub fn empty() -> Self {
        Self {
            tracks: Vec::new(),
            duration_frames: 0,
        }
    }

    pub fn new(tracks: Vec<PcmTrack>) -> Self {
        let duration_frames = tracks.iter().map(PcmTrack::end_frame).max().unwrap_or(0);
        Self {
            tracks,
            duration_frames,
        }
    }

    pub fn track(&self, id: &str) -> Option<&PcmTrack> {
        self.tracks.iter().find(|track| track.id == id)
    }
}

fn db_to_linear(db: f32) -> f32 {
    if db <= -90.0 {
        0.0
    } else {
        10.0_f32.powf(db / 20.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_is_silent_before_start_and_after_end() {
        let track = PcmTrack {
            id: "drums".into(),
            name: "Drums".into(),
            samples: Arc::from(vec![0.2, -0.2, 0.4, -0.4]),
            start_frame: 8,
            bus: TrackBus::Music,
            control: Arc::new(TrackControl::new(0.0)),
        };

        assert_eq!(track.sample_at(7), (0.0, 0.0));
        assert_eq!(track.sample_at(8), (0.2, -0.2));
        assert_eq!(track.sample_at(9), (0.4, -0.4));
        assert_eq!(track.sample_at(10), (0.0, 0.0));
    }

    #[test]
    fn song_duration_uses_latest_track_end() {
        let make = |id: &str, frames: usize, start_frame: u64| PcmTrack {
            id: id.into(),
            name: id.into(),
            samples: Arc::from(vec![0.0; frames * 2]),
            start_frame,
            bus: TrackBus::Music,
            control: Arc::new(TrackControl::new(0.0)),
        };

        let mix = SongMix::new(vec![make("a", 10, 0), make("b", 8, 20)]);
        assert_eq!(mix.duration_frames, 28);
    }

    #[test]
    fn minus_six_db_is_about_half_amplitude() {
        let control = TrackControl::new(-6.0206);
        assert!((control.gain_linear() - 0.5).abs() < 0.001);
    }
}
