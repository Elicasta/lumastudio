use thiserror::Error;

#[derive(Debug, Error)]
pub enum AudioError {
    #[error("no audio output device is available")]
    NoOutputDevice,

    #[error("audio device error: {0}")]
    Device(String),

    #[error("audio stream error: {0}")]
    Stream(String),

    #[error("failed to open audio file: {0}")]
    OpenFile(String),

    #[error("unsupported WAV channel count {0}; LumaRig Studio currently accepts mono or stereo sources")]
    UnsupportedChannels(u16),

    #[error("unsupported WAV bit depth {0}")]
    UnsupportedBitDepth(u16),

    #[error("audio file contains no samples")]
    EmptyFile,

    #[error("resampling failed: {0}")]
    Resample(String),

    #[error("audio engine is not initialized")]
    NotInitialized,

    #[error("track '{0}' was not found")]
    TrackNotFound(String),
}
