use std::{path::Path, sync::Arc};

use audioadapter_buffers::owned::InterleavedOwned;
use rubato::{Fft, FixedSync, Resampler};
use symphonia::core::{
    audio::{AudioBufferRef, Signal},
    codecs::DecoderOptions,
    formats::FormatOptions,
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
};

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
    let (samples, source_sample_rate) = read_audio_stereo(Path::new(&request.path))?;
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


pub(crate) fn read_audio_stereo(path: &Path) -> Result<(Vec<f32>, u32), AudioError> {
    match path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "wav" | "wave" => read_wav_stereo(path),
        "mp3" | "aif" | "aiff" => read_symphonia_stereo(path),
        extension => Err(AudioError::OpenFile(format!("unsupported audio format: {extension}"))),
    }
}

fn read_symphonia_stereo(path: &Path) -> Result<(Vec<f32>, u32), AudioError> {
    let file = std::fs::File::open(path).map_err(|error| AudioError::OpenFile(error.to_string()))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|value| value.to_str()) { hint.with_extension(ext); }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|error| AudioError::OpenFile(error.to_string()))?;
    let mut format = probed.format;
    let track = format.default_track().ok_or_else(|| AudioError::OpenFile("audio file has no default track".into()))?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| AudioError::OpenFile(error.to_string()))?;
    let mut sample_rate = track.codec_params.sample_rate.unwrap_or(44_100);
    let mut stereo = Vec::new();

    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id { continue; }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(error) => return Err(AudioError::OpenFile(error.to_string())),
        };
        sample_rate = decoded.spec().rate;
        let channels = decoded.spec().channels.count();
        if channels == 0 { continue; }
        match decoded {
            AudioBufferRef::F32(buffer) => append_planar_stereo(&mut stereo, &buffer, channels),
            other => {
                let spec = *other.spec();
                let duration = other.capacity() as u64;
                let mut converted = symphonia::core::audio::SampleBuffer::<f32>::new(duration, spec);
                converted.copy_interleaved_ref(other);
                let samples = converted.samples();
                for frame in samples.chunks(channels) {
                    let left = frame[0];
                    let right = if channels > 1 { frame[1] } else { left };
                    stereo.extend_from_slice(&[left, right]);
                }
            }
        }
    }
    if stereo.is_empty() { return Err(AudioError::EmptyFile); }
    Ok((stereo, sample_rate))
}

fn append_planar_stereo(out: &mut Vec<f32>, buffer: &symphonia::core::audio::AudioBuffer<f32>, channels: usize) {
    for frame in 0..buffer.frames() {
        let left = buffer.chan(0)[frame];
        let right = if channels > 1 { buffer.chan(1)[frame] } else { left };
        out.extend_from_slice(&[left, right]);
    }
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
