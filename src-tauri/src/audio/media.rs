use std::{path::Path, sync::Arc};

use audioadapter_buffers::owned::InterleavedOwned;
use rubato::{Fft, FixedSync, Resampler};

use super::{
    error::AudioError,
    model::{PcmTrack, TrackBus, TrackControl},
};

#[derive(Debug, Clone)]
pub struct WavTrackRequest {
    pub id: String,
    pub name: String,
    pub path: String,
    pub gain_db: f32,
    pub start_frame: u64,
    pub bus: TrackBus,
}

pub fn load_wav_track(
    request: &WavTrackRequest,
    target_sample_rate: u32,
) -> Result<PcmTrack, AudioError> {
    let (samples, source_sample_rate) = read_wav_stereo(Path::new(&request.path))?;
    let samples = if source_sample_rate == target_sample_rate {
        samples
    } else {
        resample_stereo(samples, source_sample_rate, target_sample_rate)?
    };

    Ok(PcmTrack {
        id: request.id.clone(),
        name: request.name.clone(),
        samples: Arc::from(samples),
        start_frame: request.start_frame,
        bus: request.bus,
        control: Arc::new(TrackControl::new(request.gain_db)),
    })
}

pub(crate) fn read_wav_stereo(path: &Path) -> Result<(Vec<f32>, u32), AudioError> {
    let mut reader =
        hound::WavReader::open(path).map_err(|error| AudioError::OpenFile(error.to_string()))?;
    let spec = reader.spec();

    if !(1..=2).contains(&spec.channels) {
        return Err(AudioError::UnsupportedChannels(spec.channels));
    }

    if spec.bits_per_sample == 0 || spec.bits_per_sample > 32 {
        return Err(AudioError::UnsupportedBitDepth(spec.bits_per_sample));
    }

    let source = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| AudioError::OpenFile(error.to_string()))?,
        hound::SampleFormat::Int => {
            let max = (1_i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|sample| {
                    sample
                        .map(|value| (value as f32 / max).clamp(-1.0, 1.0))
                        .map_err(|error| AudioError::OpenFile(error.to_string()))
                })
                .collect::<Result<Vec<_>, _>>()?
        }
    };

    if source.is_empty() {
        return Err(AudioError::EmptyFile);
    }

    let stereo = if spec.channels == 2 {
        source
    } else {
        let mut stereo = Vec::with_capacity(source.len() * 2);
        for sample in source {
            stereo.push(sample);
            stereo.push(sample);
        }
        stereo
    };

    Ok((stereo, spec.sample_rate))
}

pub(crate) fn resample_stereo(
    samples: Vec<f32>,
    source_sample_rate: u32,
    target_sample_rate: u32,
) -> Result<Vec<f32>, AudioError> {
    let frames = samples.len() / 2;

    let input = InterleavedOwned::new_from(samples, 2, frames)
        .map_err(|error| AudioError::Resample(error.to_string()))?;

    let mut resampler = Fft::<f32>::new(
        source_sample_rate as usize,
        target_sample_rate as usize,
        1024,
        2,
        FixedSync::Both,
    )
    .map_err(|error| AudioError::Resample(error.to_string()))?;

    let output = resampler
        .process_all(&input, frames, None)
        .map_err(|error| AudioError::Resample(error.to_string()))?;

    Ok(output.take_data())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resampling_preserves_stereo_shape() {
        let frames = 4_410usize;
        let mut samples = Vec::with_capacity(frames * 2);
        for frame in 0..frames {
            let value = (frame as f32 / frames as f32) * 0.5;
            samples.extend_from_slice(&[value, -value]);
        }

        let output = resample_stereo(samples, 44_100, 48_000).unwrap();

        assert_eq!(output.len() % 2, 0);
        let output_frames = output.len() / 2;
        assert!((output_frames as i64 - 4_800).abs() <= 2);
    }
}
