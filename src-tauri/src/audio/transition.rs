use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

#[derive(Debug)]
pub struct ScheduledTransition {
    active: AtomicBool,
    target_frame: AtomicU64,
    total_frames: AtomicU64,
    remaining_frames: AtomicU64,
    first_count_delay_frames: AtomicU64,
    beat_frames: AtomicU64,
    count_beats: AtomicU64,
    keep_audio: AtomicBool,
}

#[derive(Debug, Clone, Copy)]
pub struct TransitionSnapshot {
    pub active: bool,
    pub target_frame: u64,
    pub total_frames: u64,
    pub remaining_frames: u64,
    pub first_count_delay_frames: u64,
    pub beat_frames: u64,
    pub count_beats: u64,
    pub keep_audio: bool,
}

impl Default for ScheduledTransition {
    fn default() -> Self {
        Self::new()
    }
}

impl ScheduledTransition {
    pub fn new() -> Self {
        Self {
            active: AtomicBool::new(false),
            target_frame: AtomicU64::new(0),
            total_frames: AtomicU64::new(0),
            remaining_frames: AtomicU64::new(0),
            first_count_delay_frames: AtomicU64::new(0),
            beat_frames: AtomicU64::new(0),
            count_beats: AtomicU64::new(0),
            keep_audio: AtomicBool::new(false),
        }
    }

    pub fn schedule(
        &self,
        target_frame: u64,
        total_frames: u64,
        first_count_delay_frames: u64,
        beat_frames: u64,
        count_beats: u64,
        keep_audio: bool,
    ) {
        self.active.store(false, Ordering::Release);
        self.target_frame.store(target_frame, Ordering::Release);
        self.total_frames.store(total_frames, Ordering::Release);
        self.remaining_frames
            .store(total_frames, Ordering::Release);
        self.first_count_delay_frames
            .store(first_count_delay_frames.min(total_frames), Ordering::Release);
        self.beat_frames.store(beat_frames, Ordering::Release);
        self.count_beats.store(count_beats, Ordering::Release);
        self.keep_audio.store(keep_audio, Ordering::Release);
        self.active.store(true, Ordering::Release);
    }

    pub fn cancel(&self) {
        self.active.store(false, Ordering::Release);
        self.remaining_frames.store(0, Ordering::Release);
    }

    pub fn active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    pub fn snapshot(&self) -> TransitionSnapshot {
        TransitionSnapshot {
            active: self.active.load(Ordering::Acquire),
            target_frame: self.target_frame.load(Ordering::Acquire),
            total_frames: self.total_frames.load(Ordering::Acquire),
            remaining_frames: self.remaining_frames.load(Ordering::Acquire),
            first_count_delay_frames: self
                .first_count_delay_frames
                .load(Ordering::Acquire),
            beat_frames: self.beat_frames.load(Ordering::Acquire),
            count_beats: self.count_beats.load(Ordering::Acquire),
            keep_audio: self.keep_audio.load(Ordering::Acquire),
        }
    }

    pub fn store_remaining(&self, remaining_frames: u64) {
        self.remaining_frames
            .store(remaining_frames, Ordering::Release);
    }

    pub fn complete(&self) {
        self.remaining_frames.store(0, Ordering::Release);
        self.active.store(false, Ordering::Release);
    }

    pub fn current_count_beat(&self) -> Option<(u64, u64)> {
        let snapshot = self.snapshot();
        if !snapshot.active || snapshot.count_beats == 0 || snapshot.beat_frames == 0 {
            return None;
        }

        let elapsed = snapshot
            .total_frames
            .saturating_sub(snapshot.remaining_frames);

        if elapsed < snapshot.first_count_delay_frames {
            return Some((0, snapshot.count_beats));
        }

        let counted_elapsed = elapsed - snapshot.first_count_delay_frames;
        let index = counted_elapsed / snapshot.beat_frames;

        if index >= snapshot.count_beats {
            Some((snapshot.count_beats, snapshot.count_beats))
        } else {
            Some((index + 1, snapshot.count_beats))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedules_and_reports_count_progress() {
        let transition = ScheduledTransition::new();
        transition.schedule(1000, 400, 100, 100, 3, true);

        assert!(transition.active());
        assert_eq!(transition.current_count_beat(), Some((0, 3)));

        transition.store_remaining(199);
        assert_eq!(transition.current_count_beat(), Some((2, 3)));
    }

    #[test]
    fn cancel_clears_active_transition() {
        let transition = ScheduledTransition::new();
        transition.schedule(1000, 400, 0, 100, 4, false);
        transition.cancel();

        assert!(!transition.active());
        assert_eq!(transition.current_count_beat(), None);
    }
}
