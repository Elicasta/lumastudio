use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioUnitPluginInfo {
    pub identifier: String,
    pub name: String,
    pub manufacturer: String,
    pub type_name: String,
    pub version: String,
    pub category: String,
    pub component_type: u32,
    pub component_sub_type: u32,
    pub component_manufacturer: u32,
    pub has_custom_view: bool,
    pub sandbox_safe: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioUnitParameterInfo {
    pub id: u32,
    pub name: String,
    pub min: f32,
    pub max: f32,
    pub default_value: f32,
    pub value: f32,
    pub unit: u32,
    pub flags: u32,
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{AudioUnitParameterInfo, AudioUnitPluginInfo};
    use std::{
        ffi::{c_char, c_void, CStr, CString},
        ptr::NonNull,
    };

    unsafe extern "C" {
        fn luma_au_scan_json() -> *mut c_char;
        fn luma_au_free_string(value: *mut c_char);
        fn luma_au_create(
            component_type: u32,
            component_sub_type: u32,
            component_manufacturer: u32,
            sample_rate: f64,
            max_frames: u32,
            out_status: *mut i32,
        ) -> *mut c_void;
        fn luma_au_destroy(instance: *mut c_void);
        fn luma_au_send_midi(
            instance: *mut c_void,
            status: u32,
            data1: u32,
            data2: u32,
            sample_offset: u32,
        ) -> i32;
        fn luma_au_render(
            instance: *mut c_void,
            frames: u32,
            left: *mut f32,
            right: *mut f32,
        ) -> i32;
        fn luma_au_parameters_json(instance: *mut c_void) -> *mut c_char;
        fn luma_au_set_parameter(instance: *mut c_void, parameter_id: u32, value: f32) -> i32;
        fn luma_au_save_state(instance: *mut c_void) -> *mut c_char;
        fn luma_au_load_state(instance: *mut c_void, base64: *const c_char) -> i32;
    }

    pub fn scan() -> Result<Vec<AudioUnitPluginInfo>, String> {
        let raw = unsafe { luma_au_scan_json() };
        if raw.is_null() {
            return Ok(Vec::new());
        }

        let json = unsafe { CStr::from_ptr(raw) }
            .to_string_lossy()
            .into_owned();
        unsafe { luma_au_free_string(raw) };

        serde_json::from_str(&json)
            .map_err(|error| format!("Audio Unit registry returned invalid data: {error}"))
    }

    pub struct AudioUnitInstance {
        ptr: NonNull<c_void>,
    }

    unsafe impl Send for AudioUnitInstance {}
    unsafe impl Sync for AudioUnitInstance {}

    impl AudioUnitInstance {
        pub fn create(
            plugin: &AudioUnitPluginInfo,
            sample_rate: u32,
            max_frames: u32,
        ) -> Result<Self, String> {
            if plugin.category != "instrument" {
                return Err(format!(
                    "'{}' is not an instrument Audio Unit",
                    plugin.name
                ));
            }

            let mut status = 0_i32;
            let ptr = unsafe {
                luma_au_create(
                    plugin.component_type,
                    plugin.component_sub_type,
                    plugin.component_manufacturer,
                    sample_rate as f64,
                    max_frames,
                    &mut status,
                )
            };

            let ptr = NonNull::new(ptr).ok_or_else(|| {
                format!(
                    "Audio Unit '{}' could not be instantiated (OSStatus {status})",
                    plugin.name
                )
            })?;

            Ok(Self { ptr })
        }

        pub fn send_midi(&self, bytes: &[u8], sample_offset: u32) -> Result<(), String> {
            if bytes.is_empty() {
                return Ok(());
            }

            let status = bytes[0] as u32;
            let data1 = bytes.get(1).copied().unwrap_or(0) as u32;
            let data2 = bytes.get(2).copied().unwrap_or(0) as u32;
            let result = unsafe {
                luma_au_send_midi(
                    self.ptr.as_ptr(),
                    status,
                    data1,
                    data2,
                    sample_offset,
                )
            };

            os_status(result, "send MIDI")
        }

        pub fn render(
            &self,
            frames: usize,
            left: &mut [f32],
            right: &mut [f32],
        ) -> Result<(), String> {
            if frames == 0 {
                return Ok(());
            }
            if left.len() < frames || right.len() < frames {
                return Err("Audio Unit render buffers are too small".into());
            }

            let result = unsafe {
                luma_au_render(
                    self.ptr.as_ptr(),
                    frames as u32,
                    left.as_mut_ptr(),
                    right.as_mut_ptr(),
                )
            };

            os_status(result, "render")
        }

        pub fn parameters(&self) -> Result<Vec<AudioUnitParameterInfo>, String> {
            let raw = unsafe { luma_au_parameters_json(self.ptr.as_ptr()) };
            if raw.is_null() {
                return Ok(Vec::new());
            }

            let json = unsafe { CStr::from_ptr(raw) }
                .to_string_lossy()
                .into_owned();
            unsafe { luma_au_free_string(raw) };

            serde_json::from_str(&json)
                .map_err(|error| format!("Audio Unit parameter data is invalid: {error}"))
        }

        pub fn set_parameter(&self, id: u32, value: f32) -> Result<(), String> {
            let result = unsafe { luma_au_set_parameter(self.ptr.as_ptr(), id, value) };
            os_status(result, "set parameter")
        }

        pub fn save_state(&self) -> Result<String, String> {
            let raw = unsafe { luma_au_save_state(self.ptr.as_ptr()) };
            if raw.is_null() {
                return Err("Audio Unit does not expose restorable state".into());
            }

            let encoded = unsafe { CStr::from_ptr(raw) }
                .to_string_lossy()
                .into_owned();
            unsafe { luma_au_free_string(raw) };
            Ok(encoded)
        }

        pub fn load_state(&self, encoded: &str) -> Result<(), String> {
            let encoded = CString::new(encoded)
                .map_err(|_| "Audio Unit state contains an invalid NUL byte")?;
            let result = unsafe {
                luma_au_load_state(self.ptr.as_ptr(), encoded.as_ptr())
            };
            os_status(result, "restore state")
        }
    }

    impl Drop for AudioUnitInstance {
        fn drop(&mut self) {
            unsafe { luma_au_destroy(self.ptr.as_ptr()) };
        }
    }

    fn os_status(status: i32, operation: &str) -> Result<(), String> {
        if status == 0 {
            Ok(())
        } else {
            Err(format!("Audio Unit failed to {operation} (OSStatus {status})"))
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{AudioUnitParameterInfo, AudioUnitPluginInfo};

    pub fn scan() -> Result<Vec<AudioUnitPluginInfo>, String> {
        Ok(Vec::new())
    }

    pub struct AudioUnitInstance;

    impl AudioUnitInstance {
        pub fn create(
            _plugin: &AudioUnitPluginInfo,
            _sample_rate: u32,
            _max_frames: u32,
        ) -> Result<Self, String> {
            Err("Audio Unit instruments are available only on macOS".into())
        }

        pub fn send_midi(&self, _bytes: &[u8], _sample_offset: u32) -> Result<(), String> {
            Err("Audio Unit instruments are available only on macOS".into())
        }

        pub fn render(
            &self,
            _frames: usize,
            _left: &mut [f32],
            _right: &mut [f32],
        ) -> Result<(), String> {
            Err("Audio Unit instruments are available only on macOS".into())
        }

        pub fn parameters(&self) -> Result<Vec<AudioUnitParameterInfo>, String> {
            Ok(Vec::new())
        }

        pub fn set_parameter(&self, _id: u32, _value: f32) -> Result<(), String> {
            Err("Audio Unit instruments are available only on macOS".into())
        }

        pub fn save_state(&self) -> Result<String, String> {
            Err("Audio Unit instruments are available only on macOS".into())
        }

        pub fn load_state(&self, _encoded: &str) -> Result<(), String> {
            Err("Audio Unit instruments are available only on macOS".into())
        }
    }
}

pub use platform::{scan, AudioUnitInstance};
