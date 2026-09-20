use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};

use super::{
    error::AudioError,
    media::{read_wav_stereo, resample_stereo},
};

const MAX_ACTIVE_GUIDE_CLIPS: usize = 4;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceAssetManifest {
    pub token: String,
    pub file: String,
    #[serde(default)]
    pub onset_ms: f64,
    #[serde(default)]
    pub gain_db: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoicePackManifest {
    pub id: String,
    pub name: String,
    pub locale: String,
    pub voice: String,
    pub version: u32,
    pub sample_rate: u32,
    pub channels: u16,
    pub assets: Vec<VoiceAssetManifest>,
}

#[derive(Clone)]
pub struct VoiceClip {
    pub samples: Arc<[f32]>,
    pub onset_frames: u64,
    pub gain_linear: f32,
}

pub struct VoicePack {
    pub id: String,
    pub name: String,
    pub locale: String,
    pub voice: String,
    pub version: u32,
    clips: HashMap<String, VoiceClip>,
}

impl VoicePack {
    pub fn empty() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            locale: String::new(),
            voice: String::new(),
            version: 0,
            clips: HashMap::new(),
        }
    }

    pub fn clip(&self, token: &str) -> Option<&VoiceClip> {
        self.clips.get(token)
    }

    pub fn asset_count(&self) -> usize {
        self.clips.len()
    }

    pub fn loaded(&self) -> bool {
        !self.id.is_empty() && !self.clips.is_empty()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoicePackInfo {
    pub id: String,
    pub name: String,
    pub locale: String,
    pub voice: String,
    pub version: u32,
    pub asset_count: usize,
}

impl VoicePackInfo {
    pub fn from_pack(pack: &VoicePack) -> Option<Self> {
        pack.loaded().then(|| Self {
            id: pack.id.clone(),
            name: pack.name.clone(),
            locale: pack.locale.clone(),
            voice: pack.voice.clone(),
            version: pack.version,
            asset_count: pack.asset_count(),
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideTimelineEventRequest {
    pub at_seconds: f64,
    pub token: String,
    #[serde(default)]
    pub gain_db: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideTransitionEventRequest {
    pub offset_pulses: i32,
    pub token: String,
    #[serde(default)]
    pub gain_db: f32,
}

pub struct PreparedGuideEvent {
    pub start_frame: u64,
    pub samples: Arc<[f32]>,
    pub gain_linear: f32,
}

pub struct GuideSchedule {
    pub revision: u64,
    pub events: Vec<PreparedGuideEvent>,
}

impl GuideSchedule {
    pub fn empty() -> Self {
        Self {
            revision: 0,
            events: Vec::new(),
        }
    }
}

pub fn load_voice_pack(
    directory: &Path,
    target_sample_rate: u32,
) -> Result<VoicePack, AudioError> {
    let root = fs::canonicalize(directory)
        .map_err(|error| AudioError::Guide(format!("cannot open voice pack folder: {error}")))?;
    let manifest_path = root.join("manifest.json");
    let source = fs::read_to_string(&manifest_path)
        .map_err(|error| AudioError::Guide(format!("cannot read manifest.json: {error}")))?;
    let manifest: VoicePackManifest = serde_json::from_str(&source)
        .map_err(|error| AudioError::Guide(format!("invalid voice pack manifest: {error}")))?;

    validate_manifest(&manifest)?;

    let mut clips = HashMap::with_capacity(manifest.assets.len());

    for asset in &manifest.assets {
        let asset_path = safe_asset_path(&root, &asset.file)?;
        let (samples, source_sample_rate) = read_wav_stereo(&asset_path)?;
        let samples = if source_sample_rate == target_sample_rate {
            samples
        } else {
            resample_stereo(samples, source_sample_rate, target_sample_rate)?
        };

        let onset_frames =
            ((asset.onset_ms.max(0.0) / 1000.0) * target_sample_rate as f64).round() as u64;

        clips.insert(
            asset.token.clone(),
            VoiceClip {
                samples: Arc::from(samples),
                onset_frames,
                gain_linear: db_to_linear(asset.gain_db.clamp(-60.0, 24.0)),
            },
        );
    }

    Ok(VoicePack {
        id: manifest.id,
        name: manifest.name,
        locale: manifest.locale,
        voice: manifest.voice,
        version: manifest.version,
        clips,
    })
}

pub fn prepare_timeline(
    requests: &[GuideTimelineEventRequest],
    pack: &VoicePack,
    sample_rate: u32,
    revision: u64,
) -> Result<GuideSchedule, AudioError> {
    let mut events = Vec::with_capacity(requests.len());

    for request in requests {
        let clip = required_clip(pack, &request.token)?;
        let acoustic_frame = seconds_to_frame(request.at_seconds.max(0.0), sample_rate);
        events.push(PreparedGuideEvent {
            start_frame: acoustic_frame.saturating_sub(clip.onset_frames),
            samples: clip.samples.clone(),
            gain_linear: clip.gain_linear * db_to_linear(request.gain_db.clamp(-60.0, 24.0)),
        });
    }

    events.sort_by_key(|event| event.start_frame);

    Ok(GuideSchedule { revision, events })
}

pub fn prepare_transition(
    requests: &[GuideTransitionEventRequest],
    pack: &VoicePack,
    total_frames: u64,
    beat_frames: u64,
    revision: u64,
) -> Result<GuideSchedule, AudioError> {
    let mut events = Vec::with_capacity(requests.len());

    for request in requests {
        let clip = required_clip(pack, &request.token)?;
        let acoustic_frame = relative_acoustic_frame(
            total_frames,
            beat_frames,
            request.offset_pulses,
        );
        events.push(PreparedGuideEvent {
            start_frame: acoustic_frame.saturating_sub(clip.onset_frames),
            samples: clip.samples.clone(),
            gain_linear: clip.gain_linear * db_to_linear(request.gain_db.clamp(-60.0, 24.0)),
        });
    }

    events.sort_by_key(|event| event.start_frame);

    Ok(GuideSchedule { revision, events })
}

pub struct GuideRenderer {
    timeline_revision: u64,
    timeline_index: usize,
    transition_revision: u64,
    transition_index: usize,
    expected_timeline_frame: Option<u64>,
    active: Vec<ActiveGuideClip>,
}

impl Default for GuideRenderer {
    fn default() -> Self {
        Self {
            timeline_revision: 0,
            timeline_index: 0,
            transition_revision: 0,
            transition_index: 0,
            expected_timeline_frame: None,
            active: Vec::with_capacity(MAX_ACTIVE_GUIDE_CLIPS),
        }
    }
}

impl GuideRenderer {
    pub fn begin_buffer(
        &mut self,
        timeline: &GuideSchedule,
        transition: &GuideSchedule,
        playhead: u64,
        transition_active: bool,
    ) {
        if self.timeline_revision != timeline.revision {
            self.timeline_revision = timeline.revision;
            self.timeline_index = first_event_at_or_after(timeline, playhead);
            self.expected_timeline_frame = Some(playhead);
        } else if let Some(expected) = self.expected_timeline_frame {
            if !transition_active && playhead != expected {
                self.timeline_index = first_event_at_or_after(timeline, playhead);
            }
        }

        if self.transition_revision != transition.revision {
            self.transition_revision = transition.revision;
            self.transition_index = 0;
        }

        if !transition_active {
            self.transition_index = 0;
        }
    }

    pub fn trigger_timeline(&mut self, frame: u64, schedule: &GuideSchedule) {
        while let Some(event) = schedule.events.get(self.timeline_index) {
            if event.start_frame > frame {
                break;
            }

            if event.start_frame == frame {
                self.start(event);
            }

            self.timeline_index += 1;
        }

        self.expected_timeline_frame = Some(frame.saturating_add(1));
    }

    pub fn trigger_transition(&mut self, elapsed_frame: u64, schedule: &GuideSchedule) {
        while let Some(event) = schedule.events.get(self.transition_index) {
            if event.start_frame > elapsed_frame {
                break;
            }

            if event.start_frame == elapsed_frame {
                self.start(event);
            }

            self.transition_index += 1;
        }
    }

    pub fn mix_active(&mut self) -> (f32, f32) {
        let mut left = 0.0_f32;
        let mut right = 0.0_f32;
        let mut index = 0;

        while index < self.active.len() {
            let active = &mut self.active[index];
            let sample_index = active.cursor_frame as usize * 2;

            if sample_index + 1 >= active.samples.len() {
                self.active.swap_remove(index);
                continue;
            }

            left += active.samples[sample_index] * active.gain_linear;
            right += active.samples[sample_index + 1] * active.gain_linear;
            active.cursor_frame += 1;
            index += 1;
        }

        (left, right)
    }

    pub fn clear(&mut self) {
        self.active.clear();
        self.timeline_index = 0;
        self.transition_index = 0;
        self.expected_timeline_frame = None;
    }

    fn start(&mut self, event: &PreparedGuideEvent) {
        let active = ActiveGuideClip {
            samples: event.samples.clone(),
            cursor_frame: 0,
            gain_linear: event.gain_linear,
        };

        if self.active.len() < MAX_ACTIVE_GUIDE_CLIPS {
            self.active.push(active);
        } else {
            self.active[0] = active;
        }
    }
}

struct ActiveGuideClip {
    samples: Arc<[f32]>,
    cursor_frame: u64,
    gain_linear: f32,
}

fn first_event_at_or_after(schedule: &GuideSchedule, frame: u64) -> usize {
    schedule
        .events
        .iter()
        .position(|event| event.start_frame >= frame)
        .unwrap_or(schedule.events.len())
}

fn required_clip<'a>(pack: &'a VoicePack, token: &str) -> Result<&'a VoiceClip, AudioError> {
    pack.clip(token).ok_or_else(|| {
        AudioError::Guide(format!(
            "voice pack '{}' is missing token '{}'",
            pack.id, token
        ))
    })
}

fn safe_asset_path(root: &Path, relative: &str) -> Result<PathBuf, AudioError> {
    let candidate = fs::canonicalize(root.join(relative))
        .map_err(|error| AudioError::Guide(format!("missing voice asset '{relative}': {error}")))?;

    if !candidate.starts_with(root) {
        return Err(AudioError::Guide(format!(
            "voice asset escapes the pack folder: {relative}"
        )));
    }

    Ok(candidate)
}

fn validate_manifest(manifest: &VoicePackManifest) -> Result<(), AudioError> {
    if manifest.id.trim().is_empty()
        || manifest.name.trim().is_empty()
        || manifest.locale.trim().is_empty()
        || manifest.voice.trim().is_empty()
    {
        return Err(AudioError::Guide(
            "voice pack id, name, locale and voice are required".into(),
        ));
    }

    if manifest.version == 0 {
        return Err(AudioError::Guide(
            "voice pack version must be at least 1".into(),
        ));
    }

    if !(8_000..=192_000).contains(&manifest.sample_rate) {
        return Err(AudioError::Guide(
            "voice pack sampleRate is outside the supported range".into(),
        ));
    }

    if manifest.channels != 1 && manifest.channels != 2 {
        return Err(AudioError::Guide(
            "voice pack channels must be 1 or 2".into(),
        ));
    }

    let mut tokens = HashSet::with_capacity(manifest.assets.len());
    for asset in &manifest.assets {
        if asset.token.trim().is_empty() || asset.file.trim().is_empty() {
            return Err(AudioError::Guide(
                "voice assets require both token and file".into(),
            ));
        }

        if !tokens.insert(asset.token.as_str()) {
            return Err(AudioError::Guide(format!(
                "duplicate voice token '{}'",
                asset.token
            )));
        }

        if asset.onset_ms < 0.0 {
            return Err(AudioError::Guide(format!(
                "negative onsetMs for '{}'",
                asset.token
            )));
        }
    }

    for required in required_core_tokens() {
        if !tokens.contains(required.as_str()) {
            return Err(AudioError::Guide(format!(
                "missing required voice token '{required}'"
            )));
        }
    }

    Ok(())
}

fn required_core_tokens() -> Vec<String> {
    let mut tokens = Vec::with_capacity(44);

    for value in 1..=16 {
        tokens.push(format!("count.{value}"));
    }

    for value in [
        "intro",
        "verse",
        "prechorus",
        "chorus",
        "refrain",
        "bridge",
        "tag",
        "vamp",
        "turnaround",
        "instrumental",
        "interlude",
        "breakdown",
        "build",
        "drop",
        "solo",
        "outro",
        "ending",
    ] {
        tokens.push(format!("section.{value}"));
    }

    for value in [
        "hold",
        "stop",
        "repeat",
        "again",
        "last-time",
        "one-more",
        "two-more",
        "build",
        "down",
        "big",
        "soft",
    ] {
        tokens.push(format!("direction.{value}"));
    }

    tokens
}

fn relative_acoustic_frame(total_frames: u64, beat_frames: u64, offset_pulses: i32) -> u64 {
    let frame = total_frames as i128 + offset_pulses as i128 * beat_frames as i128;
    frame.clamp(0, total_frames as i128) as u64
}

fn seconds_to_frame(seconds: f64, sample_rate: u32) -> u64 {
    (seconds * sample_rate as f64).round() as u64
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

    fn test_pack() -> VoicePack {
        let mut clips = HashMap::new();
        clips.insert(
            "section.chorus".into(),
            VoiceClip {
                samples: Arc::from(vec![0.25_f32, 0.25, 0.5, 0.5]),
                onset_frames: 0,
                gain_linear: 1.0,
            },
        );
        clips.insert(
            "count.4".into(),
            VoiceClip {
                samples: Arc::from(vec![0.1_f32, 0.1]),
                onset_frames: 0,
                gain_linear: 1.0,
            },
        );

        VoicePack {
            id: "test".into(),
            name: "Test".into(),
            locale: "en-US".into(),
            voice: "Test".into(),
            version: 1,
            clips,
        }
    }

    #[test]
    fn transition_offsets_resolve_before_destination() {
        let pack = test_pack();
        let schedule = prepare_transition(
            &[
                GuideTransitionEventRequest {
                    offset_pulses: -2,
                    token: "section.chorus".into(),
                    gain_db: 0.0,
                },
                GuideTransitionEventRequest {
                    offset_pulses: -1,
                    token: "count.4".into(),
                    gain_db: 0.0,
                },
            ],
            &pack,
            250,
            100,
            1,
        )
        .unwrap();

        assert_eq!(schedule.events[0].start_frame, 50);
        assert_eq!(schedule.events[1].start_frame, 150);
    }

    #[test]
    fn renderer_plays_prepared_voice_samples() {
        let pack = test_pack();
        let schedule = prepare_transition(
            &[GuideTransitionEventRequest {
                offset_pulses: -1,
                token: "section.chorus".into(),
                gain_db: 0.0,
            }],
            &pack,
            2,
            2,
            1,
        )
        .unwrap();

        let mut renderer = GuideRenderer::default();
        renderer.begin_buffer(&GuideSchedule::empty(), &schedule, 0, true);
        renderer.trigger_transition(0, &schedule);

        assert_eq!(renderer.mix_active(), (0.25, 0.25));
        assert_eq!(renderer.mix_active(), (0.5, 0.5));
        assert_eq!(renderer.mix_active(), (0.0, 0.0));
    }
}
