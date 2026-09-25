use std::sync::atomic::{AtomicBool, Ordering};

use super::audio_unit::{
    AudioUnitInstance, AudioUnitParameterInfo, AudioUnitPluginInfo,
};

pub struct HostedEffect {
    plugin: AudioUnitPluginInfo,
    instance: AudioUnitInstance,
    enabled: AtomicBool,
    render_error: AtomicBool,
}

impl HostedEffect {
    pub fn new(
        plugin: AudioUnitPluginInfo,
        sample_rate: u32,
        max_frames: u32,
        enabled: bool,
        state: Option<&str>,
    ) -> Result<Self, String> {
        let instance = AudioUnitInstance::create_effect(
            &plugin,
            sample_rate,
            max_frames,
        )?;

        if let Some(state) = state {
            instance.load_state(state)?;
        }

        Ok(Self {
            plugin,
            instance,
            enabled: AtomicBool::new(enabled),
            render_error: AtomicBool::new(false),
        })
    }

    pub fn plugin(&self) -> &AudioUnitPluginInfo {
        &self.plugin
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Release);
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

    pub fn open_editor(&self) -> Result<(), String> {
        self.instance.open_editor()
    }

    pub fn process(
        &self,
        frames: usize,
        input_left: &[f32],
        input_right: &[f32],
        output_left: &mut [f32],
        output_right: &mut [f32],
    ) -> bool {
        if !self.enabled() {
            output_left[..frames].copy_from_slice(&input_left[..frames]);
            output_right[..frames].copy_from_slice(&input_right[..frames]);
            return true;
        }

        match self.instance.render_effect(
            frames,
            input_left,
            input_right,
            output_left,
            output_right,
        ) {
            Ok(()) => true,
            Err(_) => {
                self.render_error.store(true, Ordering::Release);
                output_left[..frames].copy_from_slice(&input_left[..frames]);
                output_right[..frames].copy_from_slice(&input_right[..frames]);
                false
            }
        }
    }

    pub fn has_render_error(&self) -> bool {
        self.render_error.load(Ordering::Acquire)
    }
}

#[derive(Default)]
pub struct InstrumentEffectChain {
    pub effects: Vec<HostedEffect>,
}

impl InstrumentEffectChain {
    pub fn empty() -> Self {
        Self { effects: Vec::new() }
    }

    pub fn any_render_error(&self) -> bool {
        self.effects.iter().any(HostedEffect::has_render_error)
    }
}
