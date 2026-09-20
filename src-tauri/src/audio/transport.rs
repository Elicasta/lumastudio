use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

#[derive(Debug)]
pub struct Transport {
    playing: AtomicBool,
    frame: AtomicU64,
    loop_enabled: AtomicBool,
    loop_start: AtomicU64,
    loop_end: AtomicU64,
}

impl Default for Transport {
    fn default() -> Self {
        Self::new()
    }
}

impl Transport {
    pub fn new() -> Self {
        Self {
            playing: AtomicBool::new(false),
            frame: AtomicU64::new(0),
            loop_enabled: AtomicBool::new(false),
            loop_start: AtomicU64::new(0),
            loop_end: AtomicU64::new(0),
        }
    }

    pub fn is_playing(&self) -> bool {
        self.playing.load(Ordering::Acquire)
    }

    pub fn play(&self) {
        self.playing.store(true, Ordering::Release);
    }

    pub fn pause(&self) {
        self.playing.store(false, Ordering::Release);
    }

    pub fn stop(&self) {
        self.playing.store(false, Ordering::Release);
        self.frame.store(0, Ordering::Release);
    }

    pub fn frame(&self) -> u64 {
        self.frame.load(Ordering::Acquire)
    }

    pub fn seek_frame(&self, frame: u64) {
        self.frame.store(frame, Ordering::Release);
    }

    pub fn set_loop(&self, start_frame: u64, end_frame: u64) {
        if end_frame <= start_frame {
            self.loop_enabled.store(false, Ordering::Release);
            return;
        }

        self.loop_start.store(start_frame, Ordering::Release);
        self.loop_end.store(end_frame, Ordering::Release);
        self.loop_enabled.store(true, Ordering::Release);
    }

    pub fn clear_loop(&self) {
        self.loop_enabled.store(false, Ordering::Release);
    }

    pub fn loop_range(&self) -> Option<(u64, u64)> {
        if !self.loop_enabled.load(Ordering::Acquire) {
            return None;
        }

        Some((
            self.loop_start.load(Ordering::Acquire),
            self.loop_end.load(Ordering::Acquire),
        ))
    }

    #[inline]
    pub fn normalize_frame(&self, mut frame: u64, duration_frames: u64) -> Option<u64> {
        if let Some((start, end)) = self.loop_range() {
            if frame >= end {
                let loop_len = end - start;
                frame = start + (frame - end) % loop_len;
            }
        }

        if duration_frames > 0 && frame >= duration_frames {
            None
        } else {
            Some(frame)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_resets_transport() {
        let transport = Transport::new();
        transport.seek_frame(42);
        transport.play();
        transport.stop();

        assert!(!transport.is_playing());
        assert_eq!(transport.frame(), 0);
    }

    #[test]
    fn loops_at_exact_end_frame() {
        let transport = Transport::new();
        transport.set_loop(100, 200);

        assert_eq!(transport.normalize_frame(199, 1000), Some(199));
        assert_eq!(transport.normalize_frame(200, 1000), Some(100));
        assert_eq!(transport.normalize_frame(205, 1000), Some(105));
    }

    #[test]
    fn end_of_song_returns_none_without_loop() {
        let transport = Transport::new();
        assert_eq!(transport.normalize_frame(1000, 1000), None);
    }
}
