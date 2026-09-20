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
    pulses_per_bar: AtomicU64,
    click_enabled: AtomicBool,
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
    pub pulses_per_bar: u64,
    pub click_enabled: bool,
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
            pulses_per_bar: AtomicU64::new(4),
            click_enabled: AtomicBool::new(true),
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
        pulses_per_bar: u64,
        click_enabled: bool,
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
        self.pulses_per_bar
            .store(pulses_per_bar.max(1), Ordering::Release);
        self.click_enabled.store(click_enabled, Ordering::Release);
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
            pulses_per_bar: self.pulses_per_bar.load(Ordering::Acquire).max(1),
            click_enabled: self.click_enabled.load(Ordering::Acquire),
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

    pub fn current_count_position(&self) -> Option<(u64, u64, u64, u64)> {
        let snapshot = self.snapshot();
        if !snapshot.active || snapshot.count_beats == 0 || snapshot.beat_frames == 0 {
            return None;
        }

        let elapsed = snapshot
            .total_frames
            .saturating_sub(snapshot.remaining_frames);

        if elapsed < snapshot.first_count_delay_frames {
            return Some((0, snapshot.pulses_per_bar, 0, count_bar_total(snapshot)));
        }

        let counted_elapsed = elapsed - snapshot.first_count_delay_frames;
        let index = (counted_elapsed / snapshot.beat_frames)
            .min(snapshot.count_beats.saturating_sub(1));
        let beat = count_beat_number(snapshot, index);
        let first_beat = count_beat_number(snapshot, 0);
        let absolute_slot = (first_beat - 1).saturating_add(index);
        let bar = absolute_slot / snapshot.pulses_per_bar + 1;

        Some((
            beat,
            snapshot.pulses_per_bar,
            bar,
            count_bar_total(snapshot),
        ))
    }
}

fn count_beat_number(snapshot: TransitionSnapshot, index: u64) -> u64 {
    let pulses = snapshot.pulses_per_bar.max(1);
    let remainder = snapshot.count_beats % pulses;
    let first_beat = if remainder == 0 {
        1
    } else {
        pulses - remainder + 1
    };

    ((first_beat - 1 + index) % pulses) + 1
}

fn count_bar_total(snapshot: TransitionSnapshot) -> u64 {
    let pulses = snapshot.pulses_per_bar.max(1);
    let remainder = snapshot.count_beats % pulses;
    let first_beat = if remainder == 0 {
        1
    } else {
        pulses - remainder + 1
    };
    let occupied_slots = first_beat - 1 + snapshot.count_beats;
    (occupied_slots + pulses - 1) / pulses
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedules_and_reports_count_progress() {
        let transition = ScheduledTransition::new();
        transition.schedule(1000, 400, 100, 100, 3, 4, true, true);

        assert!(transition.active());
        assert_eq!(transition.current_count_position(), Some((0, 4, 0, 1)));

        transition.store_remaining(199);
        assert_eq!(transition.current_count_position(), Some((3, 4, 1, 1)));
    }

    #[test]
    fn partial_count_preserves_musical_beat_numbers() {
        let transition = ScheduledTransition::new();
        transition.schedule(1000, 200, 0, 100, 2, 4, true, true);

        assert_eq!(
            transition.current_count_position(),
            Some((3, 4, 1, 1))
        );

        transition.store_remaining(99);
        assert_eq!(
            transition.current_count_position(),
            Some((4, 4, 1, 1))
        );
    }

    #[test]
    fn two_bar_count_restarts_at_beat_one() {
        let transition = ScheduledTransition::new();
        transition.schedule(1000, 800, 0, 100, 8, 4, true, true);

        transition.store_remaining(399);
        assert_eq!(
            transition.current_count_position(),
            Some((1, 4, 2, 2))
        );
    }

    #[test]
    fn cancel_clears_active_transition() {
        let transition = ScheduledTransition::new();
        transition.schedule(1000, 400, 0, 100, 4, 4, true, false);
        transition.cancel();

        assert!(!transition.active());
        assert_eq!(transition.current_count_position(), None);
    }
}
