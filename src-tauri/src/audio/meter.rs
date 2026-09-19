use super::model::AtomicF32;

#[derive(Debug)]
pub struct StereoMeter {
    left: AtomicF32,
    right: AtomicF32,
}

impl Default for StereoMeter {
    fn default() -> Self {
        Self::new()
    }
}

impl StereoMeter {
    pub fn new() -> Self {
        Self {
            left: AtomicF32::new(0.0),
            right: AtomicF32::new(0.0),
        }
    }

    pub fn store_peaks(&self, left: f32, right: f32) {
        self.left.store(left.clamp(0.0, 1.0));
        self.right.store(right.clamp(0.0, 1.0));
    }

    pub fn peaks(&self) -> (f32, f32) {
        (self.left.load(), self.right.load())
    }
}
