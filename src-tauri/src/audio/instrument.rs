use std::sync::atomic::{AtomicBool, Ordering};

use crate::midi::LiveMidiQueue;

use super::audio_unit::{
    AudioUnitInstance, AudioUnitParameterInfo, AudioUnitPluginInfo,
};

pub struct HostedInstrument {
    plugin: AudioUnitPluginInfo,
    instance: AudioUnitInstance,
    render_error: AtomicBool,
}

impl HostedInstrument {
    pub fn new(
        plugin: AudioUnitPluginInfo,
        sample_rate: u32,
        max_frames: u32,
    ) -> Result<Self, String> {
        let instance = AudioUnitInstance::create(&plugin, sample_rate, max_frames)?;
        Ok(Self {
            plugin,
            instance,
            render_error: AtomicBool::new(false),
        })
    }

    pub fn plugin(&self) -> &AudioUnitPluginInfo {
        &self.plugin
    }

    pub fn parameters(&self) -> Result<Vec<AudioUnitParameterInfo>, String> {
        self.instance.parameters()
    }

    pub fn set_parameter(&self, id: u32, value: f32) -> Result<(), String> {
        self.instance.set_parameter(id, value)
    }

    pub fn save_state(&self) -> Result<String, String> {
        self.instance.save_state()
    }

    pub fn load_state(&self, encoded: &str) -> Result<(), String> {
        self.instance.load_state(encoded)
    }

    pub fn render(
        &self,
        frames: usize,
        left: &mut [f32],
        right: &mut [f32],
        live_midi: &LiveMidiQueue,
    ) -> bool {
        while let Some(message) = live_midi.pop() {
            if self
                .instance
                .send_midi(&message.bytes[..message.len as usize], 0)
                .is_err()
            {
                self.render_error.store(true, Ordering::Release);
            }
        }

        match self.instance.render(frames, left, right) {
            Ok(()) => true,
            Err(_) => {
                self.render_error.store(true, Ordering::Release);
                left[..frames].fill(0.0);
                right[..frames].fill(0.0);
                false
            }
        }
    }

    pub fn has_render_error(&self) -> bool {
        self.render_error.load(Ordering::Acquire)
    }

    pub fn clear_render_error(&self) {
        self.render_error.store(false, Ordering::Release);
    }

    pub fn all_notes_off(&self) {
        for channel in 0..16 {
            let _ = self.instance.send_midi(&[0xb0 | channel, 123, 0], 0);
            let _ = self.instance.send_midi(&[0xb0 | channel, 120, 0], 0);
        }
    }
}
