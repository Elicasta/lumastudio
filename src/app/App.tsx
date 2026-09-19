import { useMemo, useState } from "react";
import {
  Activity,
  AudioLines,
  Cable,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Clapperboard,
  Gauge,
  Grid2X2,
  Lightbulb,
  ListMusic,
  Music2,
  Play,
  Plus,
  Radio,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Upload,
  WandSparkles
} from "lucide-react";
import { demoSetlist, goodness } from "../domain/demo";
import type { ImportStep, Page, Song } from "../domain/types";
import { checkForAppUpdate } from "../services/updater";
import { useAudioEngine, type AudioEngineController } from "../hooks/useAudioEngine";
import type { NativeAudioStatus, NativeAudioTrack } from "../services/audio";

const nav: Array<{ page: Page; label: string; icon: typeof Music2 }> = [
  { page: "setlist", label: "Setlist", icon: ListMusic },
  { page: "arrangement", label: "Song Arrangement", icon: AudioLines },
  { page: "performance", label: "Performance", icon: Play },
  { page: "pads", label: "Pads", icon: Grid2X2 },
  { page: "mixer", label: "Mixer", icon: SlidersHorizontal },
  { page: "lighting", label: "Lighting", icon: Lightbulb },
  { page: "midi", label: "MIDI", icon: Radio },
  { page: "video", label: "Video", icon: Clapperboard },
  { page: "sources", label: "Sources", icon: Upload },
  { page: "connections", label: "Connections", icon: Cable },
  { page: "settings", label: "Settings", icon: Settings }
];

function fmt(seconds: number) {
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

export function App() {
  const [page, setPage] = useState<Page>("setlist");
  const [selectedSong, setSelectedSong] = useState<Song>(goodness);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [currentSection, setCurrentSection] = useState(4);
  const audio = useAudioEngine();

  function applyNativeTracks(
    tracks: NativeAudioTrack[],
    status: NativeAudioStatus
  ) {
    setSelectedSong((song) => ({
      ...song,
      title: song.title === "Goodness of God" ? "Imported Multitrack" : song.title,
      artist: "Local Media",
      durationSeconds: Math.ceil(status.durationSeconds ?? song.durationSeconds),
      tracks: [
        ...tracks.map((track) => ({
          id: track.id,
          name: track.name,
          kind: track.kind,
          color: track.color,
          enabled: true,
          muted: false,
          solo: false,
          gainDb: track.gainDb
        })),
        ...song.tracks.filter((track) =>
          ["midi", "lighting", "video"].includes(track.kind)
        )
      ]
    }));
  }

  return (
    <div className="app-shell">
      <Sidebar page={page} onPage={setPage} />
      <main className="main">
        <Transport
          song={selectedSong}
          previewPlaying={previewPlaying}
          onPreviewPlaying={setPreviewPlaying}
          audio={audio}
        />
        <div className="workspace">
          {page === "setlist" && (
            <SetlistPage
              selected={selectedSong}
              onSelect={(song) => {
                setSelectedSong(song);
                setPage("arrangement");
              }}
              onImport={() => setImportOpen(true)}
            />
          )}
          {page === "arrangement" && <Arrangement song={selectedSong} />}
          {page === "performance" && (
            <Performance
              song={selectedSong}
              current={currentSection}
              onCurrent={setCurrentSection}
            />
          )}
          {page === "pads" && <Pads />}
          {page === "mixer" && <Mixer song={selectedSong} audio={audio} />}
          {page === "lighting" && <Lighting song={selectedSong} />}
          {page === "midi" && (
            <UtilityPage
              title="MIDI"
              icon={Radio}
              text="Patch changes, notes, CC automation, MIDI clock and device routing live here."
            />
          )}
          {page === "video" && (
            <UtilityPage
              title="Video"
              icon={Clapperboard}
              text="Section-driven local video, backgrounds, playback cues and external video outputs."
            />
          )}
          {page === "sources" && (
            <Sources
              audio={audio}
              onLoaded={(tracks, status) => {
                applyNativeTracks(tracks, status);
                setPage("arrangement");
              }}
            />
          )}
          {page === "connections" && <Connections audio={audio} />}
          {page === "settings" && <SettingsPage audio={audio} />}
        </div>
      </main>
      {importOpen && (
        <ImportWizard
          audio={audio}
          onNativeLoaded={(tracks, status) => {
            applyNativeTracks(tracks, status);
            setImportOpen(false);
            setPage("arrangement");
          }}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}

function Sidebar({
  page,
  onPage
}: {
  page: Page;
  onPage: (page: Page) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">L</div>
        <div>
          <strong>LUMARIG</strong>
          <span>STUDIO</span>
        </div>
      </div>
      <nav>
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.page}
              className={page === item.page ? "nav active" : "nav"}
              onClick={() => onPage(item.page)}
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-status">
        <span className="dot ok" /> LumaRig Connected
        <small>Audio · MIDI · Lighting ready</small>
      </div>
    </aside>
  );
}

function Transport({
  song,
  previewPlaying,
  onPreviewPlaying,
  audio
}: {
  song: Song;
  previewPlaying: boolean;
  onPreviewPlaying: (value: boolean) => void;
  audio: AudioEngineController;
}) {
  const playing = audio.hasLoadedAudio
    ? Boolean(audio.status.playing)
    : previewPlaying;

  async function togglePlay() {
    if (audio.hasLoadedAudio) {
      await audio.playPause();
    } else {
      onPreviewPlaying(!previewPlaying);
    }
  }

  async function stop() {
    if (audio.hasLoadedAudio) {
      await audio.stop();
    } else {
      onPreviewPlaying(false);
    }
  }
  return (
    <header className="transport">
      <div className="set-name">SUNDAY SET <span>⌄</span></div>
      <div className="tempo">
        <strong>{song.bpm.toFixed(1)}</strong>
        <span>BPM</span>
        <button>TAP</button>
      </div>
      <div className="meter">{song.meter[0]} / {song.meter[1]}</div>
      <button
        className={playing ? "transport-btn live" : "transport-btn"}
        onClick={() => void togglePlay()}
      >
        <Play size={19} fill="currentColor" />
      </button>
      <button className="transport-btn" onClick={() => void stop()}>
        <CircleStop size={18} />
      </button>
      <div className="quantize">1 Bar ⌄</div>
      <div className="transport-spacer" />
      <Status
        label={audio.hasLoadedAudio ? "Audio Live" : "Audio"}
        ok={!audio.status.deviceError}
      />
      <Status label="LumaRig" />
      <Status label="Remote" />
      <Gauge size={17} className="muted" />
      <span className="cpu">
        {audio.hasLoadedAudio
          ? fmtClock(audio.status.positionSeconds ?? 0) + " / " +
            fmtClock(audio.status.durationSeconds ?? 0)
          : "CPU 12%"}
      </span>
    </header>
  );
}

function Status({ label, ok = true }: { label: string; ok?: boolean }) {
  return (
    <span className="status">
      <span className={ok ? "dot ok" : "dot bad"} />
      {label}
    </span>
  );
}

function fmtClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return Math.floor(safe / 60) + ":" + String(safe % 60).padStart(2, "0");
}

function SetlistPage({
  selected,
  onSelect,
  onImport
}: {
  selected: Song;
  onSelect: (song: Song) => void;
  onImport: () => void;
}) {
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Sunday Morning</h1>
          <p>8 songs · 42 min</p>
        </div>
        <button className="primary" onClick={onImport}>
          <Plus size={16} /> Add Song
        </button>
      </div>

      <div className="panel setlist">
        <div className="song-row header">
          <span>#</span>
          <span>Title</span>
          <span>Artist</span>
          <span>BPM</span>
          <span>Key</span>
          <span>Time</span>
          <span>Audio</span>
          <span>MIDI</span>
          <span>Lighting</span>
          <span>Video</span>
          <span>Status</span>
        </div>
        {demoSetlist.songs.map((song, index) => (
          <button
            key={song.id}
            className={selected.id === song.id ? "song-row selected" : "song-row"}
            onClick={() => onSelect(song)}
          >
            <span>{index + 1}</span>
            <span className="song-title">{song.title}</span>
            <span>{song.artist}</span>
            <span>{song.bpm}</span>
            <span>{song.key}</span>
            <span>{fmt(song.durationSeconds)}</span>
            <span><i className="mini green" /></span>
            <span><i className="mini purple" /></span>
            <span><i className="mini amber" /></span>
            <span><i className="mini blue" /></span>
            <span className="ready">Ready</span>
          </button>
        ))}
      </div>

      <div className="now-playing panel">
        <div>
          <small>SELECTED SONG</small>
          <strong>{selected.title}</strong>
          <span>{selected.artist} · {selected.bpm} BPM · {selected.key}</span>
        </div>
        <div className="np-controls">
          <ChevronLeft />
          <button className="round"><Play size={18} fill="currentColor" /></button>
          <ChevronRight />
        </div>
        <div className="progress"><span style={{ width: "36%" }} /></div>
        <span>1:54 / {fmt(selected.durationSeconds)}</span>
      </div>
    </section>
  );
}

function Arrangement({ song }: { song: Song }) {
  const totalBars = Math.max(
    ...song.sections.map((section) => section.startBar + section.lengthBars - 1)
  );

  return (
    <section className="arrange-page">
      <div className="page-head">
        <div>
          <h1>{song.title}</h1>
          <p>
            {song.bpm} BPM · {song.key} · {song.meter.join("/")} · {fmt(song.durationSeconds)}
          </p>
        </div>
        <div className="head-actions">
          <button>Edit</button>
          <button className="primary">Save</button>
        </div>
      </div>

      <div className="timeline panel">
        <div className="section-ruler">
          <div className="track-label ruler-label">SECTIONS</div>
          <div className="ruler-content">
            {song.sections.map((section) => (
              <div
                key={section.id}
                className="section-block"
                style={{
                  width: (section.lengthBars / totalBars * 100) + "%",
                  background: section.color
                }}
              >
                {section.name}
              </div>
            ))}
          </div>
        </div>

        {song.tracks.map((track, index) => (
          <div className="track-lane" key={track.id}>
            <div className="track-label">
              <button>S</button>
              <button>M</button>
              <span style={{ color: track.color }}>{track.name}</span>
            </div>
            <div className={"lane lane-" + track.kind}>
              {track.kind === "lighting" ? (
                <LightingAutomation />
              ) : track.kind === "video" ? (
                <VideoLane />
              ) : (
                <Waveform seed={index} color={track.color} />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="inspector panel">
        <div>
          <small>SECTION</small>
          <strong>Chorus 2</strong>
          <span>Bars 57–72 · 16 bars</span>
        </div>
        <Field label="Lighting Cue" value="Chorus Wide" />
        <Field label="MIDI Patch" value="12 · Chorus" />
        <Field label="Video" value="03 · Chorus BG" />
        <Field label="Follow" value="Next Section" />
      </div>
    </section>
  );
}

function Waveform({ seed, color }: { seed: number; color: string }) {
  const bars = useMemo(
    () => Array.from({ length: 94 }, (_, index) => 20 + ((index * 19 + seed * 31) % 64)),
    [seed]
  );

  return (
    <div className="wave" style={{ color }}>
      {bars.map((height, index) => (
        <i key={index} style={{ height: height + "%" }} />
      ))}
    </div>
  );
}

function LightingAutomation() {
  return (
    <svg className="automation" viewBox="0 0 1000 58" preserveAspectRatio="none">
      <polyline points="0,42 120,38 120,20 260,20 260,44 430,44 430,15 610,15 610,34 780,34 780,10 1000,30" />
    </svg>
  );
}

function VideoLane() {
  return (
    <div className="video-lane">
      {["Intro", "Verse", "Chorus", "Verse", "Bridge", "Finale"].map((label) => (
        <div key={label}>
          <Clapperboard size={13} />
          {label}
        </div>
      ))}
    </div>
  );
}

function Performance({
  song,
  current,
  onCurrent
}: {
  song: Song;
  current: number;
  onCurrent: (value: number) => void;
}) {
  const active = song.sections[Math.min(current, song.sections.length - 1)];
  const next = song.sections[Math.min(current + 1, song.sections.length - 1)];

  return (
    <section className="performance-page">
      <div className="page-head">
        <div>
          <h1>Performance</h1>
          <p>{song.title} · {song.bpm} BPM · {song.key}</p>
        </div>
        <span className="performance-lock">
          <Activity size={15} /> LIVE SAFE
        </span>
      </div>

      <div className="section-strip panel">
        {song.sections.map((section, index) => (
          <button
            key={section.id}
            className={index === current ? "section-card current" : "section-card"}
            onClick={() => onCurrent(index)}
          >
            <strong>{section.name}</strong>
            <span>{section.lengthBars} Bars</span>
          </button>
        ))}
      </div>

      <div className="performance-grid">
        <div className="hero-cue panel">
          <small>CURRENT SECTION</small>
          <h2>{active.name}</h2>
          <p>Bar {active.startBar + 4} / {active.startBar + active.lengthBars - 1}</p>
          <div className="hero-progress"><span style={{ width: "42%" }} /></div>
        </div>
        <div className="next-cue panel">
          <small>UP NEXT</small>
          <h3>{next.name}</h3>
          <p>{next.lengthBars} bars</p>
        </div>
        <div className="live-status panel">
          <h3>Live Status</h3>
          <Status label="Audio Engine" />
          <Status label="MIDI Clock" />
          <Status label="LumaRig Lighting" />
          <Status label="Remote" />
        </div>
      </div>

      <div className="go-row">
        <button onClick={() => onCurrent(Math.max(0, current - 1))}>
          <ChevronLeft /> Previous
        </button>
        <button
          className="go"
          onClick={() => onCurrent(Math.min(song.sections.length - 1, current + 1))}
        >
          GO
        </button>
        <button
          onClick={() => onCurrent(Math.min(song.sections.length - 1, current + 1))}
        >
          Next <ChevronRight />
        </button>
      </div>
    </section>
  );
}

const padNames = [
  "Warmth",
  "Air",
  "Deep",
  "Shimmer",
  "Bloom",
  "Motion",
  "Glass",
  "Soft",
  "Wide",
  "Choir",
  "Atmos",
  "Ritual"
];

function Pads() {
  const [active, setActive] = useState(0);
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Pad Player</h1>
          <p>12 customizable background pads · Bank A</p>
        </div>
        <button>+ Bank</button>
      </div>

      <div className="pads-layout">
        <div className="pad-grid">
          {padNames.map((name, index) => (
            <button
              key={name}
              className={index === active ? "pad active-pad" : "pad"}
              onClick={() => setActive(index)}
            >
              <span>{index + 1}</span>
              <Waveform
                seed={index}
                color={["#fbbf24", "#60a5fa", "#f472b6", "#2dd4bf"][index % 4]}
              />
              <strong>{name}</strong>
            </button>
          ))}
        </div>

        <div className="panel pad-inspector">
          <small>PAD {active + 1}</small>
          <h2>{padNames[active]}</h2>
          <Waveform seed={active} color="#fbbf24" />
          <Field label="Octave" value="0" />
          <Field label="Wideness" value="70%" />
          <Field label="Volume" value="0.0 dB" />
          <Field label="Release" value="1.8 s" />
          <button className="primary">Replace WAV / MP3</button>
        </div>
      </div>
    </section>
  );
}

function Mixer({ song }: { song: Song }) {
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Mixer</h1>
          <p>{song.title}</p>
        </div>
      </div>
      <div className="mixer panel">
        {song.tracks
          .filter((track) => !["lighting", "video", "midi"].includes(track.kind))
          .map((track, index) => (
            <div className="channel" key={track.id}>
              <strong style={{ color: track.color }}>{track.name}</strong>
              <div className="meter-bars">
                <i style={{ height: 35 + (index * 8 % 55) + "%" }} />
                <i style={{ height: 28 + (index * 11 % 60) + "%" }} />
              </div>
              <input type="range" min="-60" max="6" defaultValue={track.gainDb} />
              <span>{track.gainDb.toFixed(1)} dB</span>
              <div>
                <button>S</button>
                <button>M</button>
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}

function Lighting({ song }: { song: Song }) {
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Lighting</h1>
          <p>Section cues and automation · {song.title}</p>
        </div>
        <button className="primary">Test Output</button>
      </div>

      <div className="lighting-layout">
        <div className="panel fixtures">
          <h3>Groups</h3>
          {["All Fixtures", "Front Wash", "Back Wash", "Movers", "Blinders", "Stage FX", "LED Bars"].map(
            (label, index) => (
              <button
                key={label}
                className={index === 3 ? "fixture selected" : "fixture"}
              >
                <span
                  className="swatch"
                  style={{
                    background: ["#60a5fa", "#fb923c", "#fb7185", "#a78bfa", "#22c55e", "#f472b6", "#38bdf8"][index]
                  }}
                />
                {label}
                <span>{index === 0 ? 32 : 8}</span>
              </button>
            )
          )}
        </div>

        <div className="panel lighting-timeline">
          <div className="section-ruler">
            {song.sections.map((section) => (
              <div
                key={section.id}
                className="section-block"
                style={{ flex: section.lengthBars, background: section.color }}
              >
                {section.name}
              </div>
            ))}
          </div>
          {["Intensity", "Color", "Movement", "Beam", "Strobe", "FX"].map(
            (lane, index) => (
              <div className="light-lane" key={lane}>
                <strong>{lane}</strong>
                <div>
                  <Waveform
                    seed={index}
                    color={["#60a5fa", "#f472b6", "#22d3ee", "#a78bfa", "#cbd5e1", "#8b5cf6"][index]}
                  />
                </div>
              </div>
            )
          )}
        </div>

        <div className="panel cue-inspector">
          <small>CUE</small>
          <h2>Chorus Hit</h2>
          <Field label="Trigger" value="1 Bar" />
          <Field label="Fade" value="2.0 s" />
          <Field label="Movement" value="Circle" />
          <Field label="Intensity" value="100%" />
          <Field label="Output" value="LumaRig" />
        </div>
      </div>
    </section>
  );
}

function Connections() {
  const cards = [
    ["Audio I/O", "Universal Audio Apollo X", "48 kHz · 128 samples"],
    ["MIDI", "LumaRig MIDI (Virtual)", "Clock + Start/Stop"],
    ["Clock Sync", "Internal (LumaRig)", "120.00 BPM"],
    ["Lighting", "LumaRig / Art-Net", "Universe 0 · 40 Hz"],
    ["Remote Devices", "iPad Pro + iPhone", "2 connected"],
    ["Network", "lumastudio.local", "OSC 8000 / 8001"]
  ];

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Connections</h1>
          <p>Audio, MIDI, lighting, network and remote integrations</p>
        </div>
        <span className="ready"><span className="dot ok" /> All Systems Operational</span>
      </div>
      <div className="connection-grid">
        {cards.map(([title, value, detail]) => (
          <div className="panel connection-card" key={title}>
            <div className="card-head">
              <h3>{title}</h3>
              <span className="ready">Connected</span>
            </div>
            <strong>{value}</strong>
            <p>{detail}</p>
            <button>Configure</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsPage() {
  const [message, setMessage] = useState(
    "Updater ready after signing keys are configured."
  );
  const [busy, setBusy] = useState(false);

  async function update(install: boolean) {
    setBusy(true);
    const result = await checkForAppUpdate(install);
    setMessage(result.message);
    setBusy(false);
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Application, performance and release settings</p>
        </div>
      </div>

      <div className="settings-grid">
        <div className="panel settings-card">
          <h3>Audio Engine</h3>
          <Field label="Sample Rate" value="48,000 Hz" />
          <Field label="Buffer" value="128 samples" />
          <Field label="Master Output" value="Output 1–2" />
        </div>

        <div className="panel settings-card">
          <h3>Software Update</h3>
          <p>{message}</p>
          <div className="head-actions">
            <button disabled={busy} onClick={() => update(false)}>Check</button>
            <button className="primary" disabled={busy} onClick={() => update(true)}>
              Check + Install
            </button>
          </div>
        </div>

        <div className="panel settings-card">
          <h3>Performance Safety</h3>
          <p>
            AI jobs pause during Performance Mode. Editing actions can be locked
            while a show is live.
          </p>
          <label className="toggle-line">
            <span>Live Performance Lock</span>
            <input type="checkbox" defaultChecked />
          </label>
        </div>
      </div>
    </section>
  );
}

function UtilityPage({
  title,
  text,
  icon: Icon
}: {
  title: string;
  text: string;
  icon: typeof Music2;
}) {
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p>{text}</p>
        </div>
      </div>
      <div className="panel utility">
        <Icon size={42} />
        <h2>{title} workspace</h2>
        <p>{text}</p>
        <button className="primary">Open {title}</button>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ImportWizard({ onClose }: { onClose: () => void }) {
  const steps: ImportStep[] = ["source", "analyze", "stems", "sections", "review"];
  const [step, setStep] = useState<ImportStep>("source");
  const index = steps.indexOf(step);
  const next = () => setStep(steps[Math.min(steps.length - 1, index + 1)]);

  return (
    <div className="modal-backdrop">
      <div className="import-modal panel">
        <div className="modal-head">
          <div>
            <small>ADD SONG</small>
            <h2>
              {["Choose Source", "Analyze Song", "Split Stems", "Map Sections", "Review + Create"][index]}
            </h2>
          </div>
          <button onClick={onClose}>×</button>
        </div>

        <div className="stepper">
          {steps.map((item, itemIndex) => (
            <div key={item} className={itemIndex <= index ? "step active" : "step"}>
              <i>{itemIndex + 1}</i>
              <span>{item}</span>
            </div>
          ))}
        </div>

        {step === "source" && (
          <div className="source-step">
            <div className="dropzone">
              <Upload size={34} />
              <h3>Drop a song here</h3>
              <p>WAV, MP3, M4A or a licensed multitrack folder</p>
              <button className="primary" onClick={next}>Choose File</button>
            </div>
            <div className="source-options">
              <button onClick={next}>
                <Upload />
                <strong>Import Multitrack</strong>
                <span>Individual stems</span>
              </button>
              <button onClick={next}>
                <WandSparkles />
                <strong>Split Stereo Song</strong>
                <span>AI stem separation</span>
              </button>
              <button onClick={next}>
                <Plus />
                <strong>Empty Song</strong>
                <span>Start from scratch</span>
              </button>
            </div>
          </div>
        )}

        {step === "analyze" && (
          <div className="analyze-step">
            <div className="analysis-file">
              <Music2 />
              <div>
                <strong>Goodness of God.wav</strong>
                <span>5:18 · 44.1 kHz · Stereo</span>
              </div>
            </div>
            <div className="analysis-stats">
              <Field label="Tempo" value="63 BPM" />
              <Field label="Key" value="Ab Major" />
              <Field label="Time Signature" value="4/4" />
              <Field label="Downbeat" value="0:00.842" />
            </div>
            <button className="primary wide" onClick={next}>
              Continue to Stem Split
            </button>
          </div>
        )}

        {step === "stems" && (
          <div className="stem-step">
            <h3>Stem Separation</h3>
            <p>Band Split creates performance-ready track columns automatically.</p>
            <div className="stem-cards">
              <button>
                <strong>Quick Split</strong>
                <span>Drums · Bass · Vocals · Music</span>
              </button>
              <button className="selected">
                <strong>Band Split</strong>
                <span>Drums · Bass · Vocals · Guitar · Keys · Other</span>
              </button>
              <button>
                <strong>Vocals / Instrumental</strong>
                <span>Fast two-track split</span>
              </button>
            </div>
            <div className="processing">
              <Sparkles />
              <div>
                <strong>Ready to separate locally</strong>
                <span>AI processing will run outside the realtime audio thread.</span>
              </div>
            </div>
            <button className="primary wide" onClick={next}>Start Separation</button>
          </div>
        )}

        {step === "sections" && (
          <div className="map-step">
            <div className="mini-wave">
              <Waveform seed={4} color="#60a5fa" />
            </div>
            <div className="section-buttons">
              {["INTRO", "VERSE", "PRE", "CHORUS", "BRIDGE", "TAG", "INSTRUMENTAL", "OUTRO"].map(
                (label) => <button key={label}>{label}</button>
              )}
            </div>
            <p>
              Tap a section while the song plays. The next marker closes the
              previous section and snaps to the nearest bar.
            </p>
            <button className="primary wide" onClick={next}>Looks Good</button>
          </div>
        )}

        {step === "review" && (
          <div className="review-step">
            <div className="review-checks">
              {[
                "Tempo, key and downbeat analyzed",
                "6 stems mapped to track columns",
                "8 sections mapped to the musical grid",
                "Click + guide lanes prepared",
                "MIDI, lighting and video lanes ready"
              ].map((label) => (
                <div key={label}><span className="dot ok" />{label}</div>
              ))}
            </div>
            <button className="primary wide" onClick={onClose}>Create Song</button>
          </div>
        )}
      </div>
    </div>
  );
}
