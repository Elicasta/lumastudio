use std::sync::atomic::{AtomicBool, Ordering};

use super::model::AtomicF32;

#[derive(Debug)]
pub struct BusControl {
    gain_db: AtomicF32,
    gain_linear: AtomicF32,
    muted: AtomicBool,
}

impl BusControl {
    pub fn new(gain_db: f32) -> Self {
        let gain_db = gain_db.clamp(-90.0, 12.0);
        Self {
            gain_db: AtomicF32::new(gain_db),
            gain_linear: AtomicF32::new(db_to_linear(gain_db)),
            muted: AtomicBool::new(false),
        }
    }

    #[inline]
    pub fn gain_linear(&self) -> f32 {
        if self.muted() {
            0.0
        } else {
            self.gain_linear.load()
        }
    }

    pub fn gain_db(&self) -> f32 {
        self.gain_db.load()
    }

    pub fn set_gain_db(&self, gain_db: f32) {
        let gain_db = gain_db.clamp(-90.0, 12.0);
        self.gain_db.store(gain_db);
        self.gain_linear.store(db_to_linear(gain_db));
    }

    pub fn muted(&self) -> bool {
        self.muted.load(Ordering::Relaxed)
    }

    pub fn set_muted(&self, muted: bool) {
        self.muted.store(muted, Ordering::Relaxed);
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
    fn muted_bus_is_silent_without_losing_gain_setting() {
        let bus = BusControl::new(-6.0206);
        assert!((bus.gain_linear() - 0.5).abs() < 0.001);

        bus.set_muted(true);
        assert_eq!(bus.gain_linear(), 0.0);

        bus.set_muted(false);
        assert!((bus.gain_linear() - 0.5).abs() < 0.001);
    }

    #[test]
    fn bus_gain_is_clamped() {
        let bus = BusControl::new(0.0);
        bus.set_gain_db(50.0);
        assert_eq!(bus.gain_db(), 12.0);
    }
}
