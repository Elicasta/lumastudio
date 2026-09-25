use std::sync::atomic::{AtomicBool, Ordering};

use crate::midi::LiveMidiQueue;

use super::audio_unit::{
    AudioUnitInstance, AudioUnitParameterInfo, AudioUnitPluginInfo,
};

#[derive(Debug, Clone)]
pub struct InstrumentMidiEvent {
    pub frame: u64,
    pub bytes: [u8; 3],
    pub len: u8,
}

#[derive(Debug, Clone, Default)]
pub struct InstrumentMidiSchedule {
    pub events: Vec<InstrumentMidiEvent>,
}

impl InstrumentMidiSchedule {
    pub fn empty() -> Self {
        Self { events: Vec::new() }
    }
}

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

    pub fn dispatch_timeline_range(
        &self,
        schedule: &InstrumentMidiSchedule,
        start_frame: u64,
        frames: usize,
        render_offset: usize,
    ) {
        if frames == 0 || schedule.events.is_empty() {
            return;
        }

        let end_frame = start_frame.saturating_add(frames as u64);
        let start_index = schedule
            .events
            .partition_point(|event| event.frame < start_frame);
        let end_index = schedule
            .events
            .partition_point(|event| event.frame < end_frame);

        for event in &schedule.events[start_index..end_index] {
            let sample_offset = render_offset
                .saturating_add(event.frame.saturating_sub(start_frame) as usize)
                .min(u32::MAX as usize) as u32;
            if self
                .instance
                .send_midi(&event.bytes[..event.len as usize], sample_offset)
                .is_err()
            {
                self.render_error.store(true, Ordering::Release);
            }
        }
    }

    pub fn all_notes_off_at(&self, sample_offset: u32) {
        for channel in 0..16 {
            let _ = self
                .instance
                .send_midi(&[0xb0 | channel, 123, 0], sample_offset);
            let _ = self
                .instance
                .send_midi(&[0xb0 | channel, 120, 0], sample_offset);
        }
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
        self.all_notes_off_at(0);
    }
}
