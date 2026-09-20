import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
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
import type { CountInSettings, ImportStep, Page, Song } from "../domain/types";
import { adjacentSong } from "../domain/setlist";
import {
  musicalPositionAtSeconds,
  planManualSectionJump,
  planSongCountIn,
  sectionIndexAtSeconds,
  sectionStartSeconds
} from "../domain/timing";
import { useRemoteRelay } from "../hooks/useRemoteRelay";
import type { RemoteCommandEnvelope } from "../remote/protocol";
import { buildRemoteStudioState } from "../remote/state";
import { checkForAppUpdate } from "../services/updater";
import { useAudioEngine, type AudioEngineController } from "../hooks/useAudioEngine";
import type { NativeAudioStatus, NativeAudioTrack } from "../services/audio";

const nav: Array<{ page: Page; label: string; icon: typeof Music2 }> = [
  { page: "setlist", label: "Setlist", icon: ListMusic },
  { page: "songs", label: "Songs", icon: Music2 },
  { page: "arrangement", label: "Arrangement", icon: AudioLines },
  { page: "performance", label: "Performance", icon: Play },
  { page: "pads", label: "Pads", icon: Grid2X2 },
  { page: "mixer", label: "Mixer", icon: SlidersHorizontal },
  { page: "lighting", label: "Lighting", icon: Lightbulb },
  { page: "midi", label: "MIDI", icon: Radio },
  { page: "video", label: "Video", icon: Clapperboard },
  { page: "sources", label: "Sources", icon: Upload },
  { page: "connections", label: "Devices", icon: Cable },
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
  const [queuedManualSection, setQueuedManualSection] = useState<number | null>(null);
  const audio = useAudioEngine();

  const selectSetlistSong = useCallback(
    async (song: Song) => {
      if (audio.hasLoadedAudio) {
        await audio.stop();
      }
      setPreviewPlaying(false);
      setQueuedManualSection(null);
      setSelectedSong(song);
      setCurrentSection(0);
    },
    [audio.hasLoadedAudio, audio.stop]
  );

  const startPlayback = useCallback(async () => {
    if (!audio.hasLoadedAudio) {
      setPreviewPlaying(true);
      return;
    }

    if (audio.status.countInActive) return;
    if (audio.status.playing) return;

    const position = audio.status.positionSeconds ?? 0;
    if (position <= 0.05) {
      const countIn = planSongCountIn(selectedSong);

      if (countIn.countBeats > 0) {
        await audio.scheduleTransition({
          targetSeconds: 0,
          delaySeconds: countIn.launchAfterSeconds,
          firstCountDelaySeconds: 0,
          beatSeconds: countIn.beatSeconds,
          countBeats: countIn.countBeats,
          keepAudio: false
        });
        return;
      }
    }

    await audio.playPause();
  }, [
    audio.hasLoadedAudio,
    audio.playPause,
    audio.scheduleTransition,
    audio.status.countInActive,
    audio.status.playing,
    audio.status.positionSeconds,
    selectedSong
  ]);

  const pausePlayback = useCallback(async () => {
    if (!audio.hasLoadedAudio) {
      setPreviewPlaying(false);
      return;
    }

    if (audio.status.countInActive) {
      await audio.cancelTransition();
      return;
    }

    if (audio.status.playing) {
      await audio.playPause();
    }
  }, [
    audio.cancelTransition,
    audio.hasLoadedAudio,
    audio.playPause,
    audio.status.countInActive,
    audio.status.playing
  ]);

  const launchSection = useCallback(
    async (index: number) => {
      const target = selectedSong.sections[index];
      if (!target) return;

      if (
        audio.hasLoadedAudio &&
        audio.status.playing &&
        !audio.status.countInActive
      ) {
        const position = audio.status.positionSeconds ?? 0;
        const plan = planManualSectionJump(selectedSong, position, target);

        setQueuedManualSection(index);
        await audio.scheduleTransition({
          targetSeconds: plan.targetSeconds,
          delaySeconds: plan.launchAfterSeconds,
          firstCountDelaySeconds: plan.firstCountAfterSeconds,
          beatSeconds: plan.beatSeconds,
          countBeats: plan.countBeats,
          keepAudio: true
        });
        return;
      }

      if (audio.hasLoadedAudio) {
        await audio.seek(sectionStartSeconds(selectedSong, index));
      }

      setQueuedManualSection(null);
      setCurrentSection(index);
    },
    [
      audio.hasLoadedAudio,
      audio.scheduleTransition,
      audio.seek,
      audio.status.countInActive,
      audio.status.playing,
      audio.status.positionSeconds,
      selectedSong
    ]
  );

  useEffect(() => {
    if (!audio.hasLoadedAudio || !audio.status.playing) return;
    if (audio.status.countInActive) return;

    const index = sectionIndexAtSeconds(
      selectedSong,
      audio.status.positionSeconds ?? 0
    );

    setCurrentSection((current) => (current === index ? current : index));
    setQueuedManualSection((queued) => (queued === index ? null : queued));
  }, [
    audio.hasLoadedAudio,
    audio.status.countInActive,
    audio.status.playing,
    audio.status.positionSeconds,
    selectedSong
  ]);

  const handleRemoteCommand = useCallback(
    async (message: RemoteCommandEnvelope) => {
      const ok = () => ({ id: message.id, ok: true });
      const reject = (error: string) => ({ id: message.id, ok: false, error });

      switch (message.command) {
        case "transport.play":
          await startPlayback();
          return ok();

        case "transport.pause":
          await pausePlayback();
          return ok();

        case "transport.stop":
          if (audio.hasLoadedAudio) await audio.stop();
          setPreviewPlaying(false);
          return ok();

        case "transport.go":
        case "transport.next":
          await launchSection(
            Math.min(selectedSong.sections.length - 1, currentSection + 1)
          );
          return ok();

        case "transport.previous":
          await launchSection(Math.max(0, currentSection - 1));
          return ok();

        case "section.launch": {
          const id = String(message.payload?.id ?? "");
          const index = selectedSong.sections.findIndex((section) => section.id === id);
          if (index < 0) return reject("Section not found in the current Song.");
          await launchSection(index);
          return ok();
        }

        case "song.next":
        case "song.previous": {
          const direction = message.command === "song.next" ? 1 : -1;
          const song = adjacentSong(
            demoSetlist,
            selectedSong.id,
            direction as -1 | 1
          );
          if (!song) {
            return reject(
              direction === 1 ? "End of Setlist." : "Start of Setlist."
            );
          }
          await selectSetlistSong(song);
          return ok();
        }

        case "song.select": {
          const id = String(message.payload?.id ?? "");
          const song = demoSetlist.songs.find((item) => item.id === id);
          if (!song) return reject("Song not found in the active Setlist.");
          await selectSetlistSong(song);
          return ok();
        }

        case "mixer.gain": {
          const id = String(message.payload?.id ?? "");
          const gainDb = Number(message.payload?.gainDb);
          if (!Number.isFinite(gainDb)) return reject("Invalid gain value.");

          setSelectedSong((song) => ({
            ...song,
            tracks: song.tracks.map((track) =>
              track.id === id ? { ...track, gainDb } : track
            )
          }));

          if (audio.tracks.some((track) => track.id === id)) {
            await audio.setTrackGain(id, gainDb);
          }
          return ok();
        }

        case "mixer.mute": {
          const id = String(message.payload?.id ?? "");
          const muted = Boolean(message.payload?.muted);

          setSelectedSong((song) => ({
            ...song,
            tracks: song.tracks.map((track) =>
              track.id === id ? { ...track, muted } : track
            )
          }));

          if (audio.tracks.some((track) => track.id === id)) {
            await audio.setTrackMuted(id, muted);
          }
          return ok();
        }

        case "mixer.solo": {
          const id = String(message.payload?.id ?? "");
          const solo = Boolean(message.payload?.solo);

          setSelectedSong((song) => ({
            ...song,
            tracks: song.tracks.map((track) =>
              track.id === id ? { ...track, solo } : track
            )
          }));

          if (audio.tracks.some((track) => track.id === id)) {
            await audio.setTrackSolo(id, solo);
          }
          return ok();
        }

        case "pad.trigger":
        case "pad.release":
          return reject("Pad audio runtime is not wired yet.");

        case "lighting.blackout":
        case "lighting.scene":
        case "lighting.xy":
          return reject("Lighting runtime is not wired yet.");
      }
    },
    [
      audio.hasLoadedAudio,
      currentSection,
      launchSection,
      pausePlayback,
      startPlayback,
      audio.setTrackGain,
      audio.setTrackMuted,
      audio.setTrackSolo,
      audio.status.playing,
      audio.stop,
      audio.tracks,
      selectSetlistSong,
      selectedSong.id,
      selectedSong.sections
    ]
  );

  const remoteState = useMemo(
    () =>
      buildRemoteStudioState({
        setlist: demoSetlist,
        song: selectedSong,
        currentSectionIndex: currentSection,
        previewPlaying,
        audioStatus: audio.status,
        queuedSectionIndex: queuedManualSection
      }),
    [audio.status, currentSection, previewPlaying, queuedManualSection, selectedSong]
  );

  const remote = useRemoteRelay(remoteState, handleRemoteCommand);

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
          remoteOnline={remote.status === "online"}
          onStart={startPlayback}
          onPause={pausePlayback}
        />
        <div className="workspace">
          {page === "setlist" && (
            <SetlistPage
              selected={selectedSong}
              audio={audio}
              onSelect={(song) => void selectSetlistSong(song)}
              onOpenArrangement={() => setPage("arrangement")}
              onImport={() => setImportOpen(true)}
              onSongChange={setSelectedSong}
              onStart={startPlayback}
              onPause={pausePlayback}
            />
          )}
          {page === "songs" && (
            <SongsPage
              selected={selectedSong}
              onSelect={(song) => void selectSetlistSong(song)}
              onOpenArrangement={() => setPage("arrangement")}
              onImport={() => setImportOpen(true)}
            />
          )}
          {page === "arrangement" && (
            <Arrangement
              song={selectedSong}
              onSongChange={setSelectedSong}
            />
          )}
          {page === "performance" && (
            <Performance
              song={selectedSong}
              current={currentSection}
              nextSong={adjacentSong(demoSetlist, selectedSong.id, 1)}
              onNextSong={(song) => void selectSetlistSong(song)}
              remoteOnline={remote.status === "online"}
              remoteClients={remote.remoteClients}
              audio={audio}
              queuedManualSection={queuedManualSection}
              onLaunchSection={(index) => void launchSection(index)}
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
          {page === "connections" && <Connections audio={audio} remote={remote} />}
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
          <span>STUDIO · BETA 0.2.0</span>
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
  audio,
  remoteOnline,
  onStart,
  onPause
}: {
  song: Song;
  previewPlaying: boolean;
  onPreviewPlaying: (value: boolean) => void;
  audio: AudioEngineController;
  remoteOnline: boolean;
  onStart: () => Promise<void>;
  onPause: () => Promise<void>;
}) {
  const playing = audio.hasLoadedAudio
    ? Boolean(audio.status.playing)
    : previewPlaying;
  const counting = Boolean(audio.status.countInActive);

  async function togglePlay() {
    if (playing || counting) {
      await onPause();
    } else {
      await onStart();
    }
  }

  async function stop() {
    if (audio.hasLoadedAudio) {
      await audio.stop();
    } else {
      onPreviewPlaying(false);
    }
  }

  const countLabel = counting
    ? audio.status.countInBeat
      ? "COUNT " + audio.status.countInBeat + "/" + (audio.status.countInTotal ?? 0)
      : "COUNT READY"
    : "1 Bar ⌄";

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
        className={playing || counting ? "transport-btn live" : "transport-btn"}
        onClick={() => void togglePlay()}
        aria-label={counting ? "Cancel count-in" : playing ? "Pause" : "Play"}
      >
        <Play size={19} fill="currentColor" />
      </button>
      <button className="transport-btn" onClick={() => void stop()}>
        <CircleStop size={18} />
      </button>
      <div className={counting ? "quantize counting" : "quantize"}>{countLabel}</div>
      <div className="transport-spacer" />
      <Status
        label={audio.hasLoadedAudio ? "Audio Live" : "Audio"}
        ok={!audio.status.deviceError}
      />
      <Status label="LumaRig" />
      <Status label="Remote" ok={remoteOnline} />
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
  audio,
  onSelect,
  onOpenArrangement,
  onImport,
  onSongChange,
  onStart,
  onPause
}: {
  selected: Song;
  audio: AudioEngineController;
  onSelect: (song: Song) => void;
  onOpenArrangement: () => void;
  onImport: () => void;
  onSongChange: (song: Song) => void;
  onStart: () => Promise<void>;
  onPause: () => Promise<void>;
}) {
  const displayedTracks = selected.tracks.filter((track) =>
    ["click", "guide", "drums", "bass", "keys", "guitar", "vocals", "other", "midi", "lighting", "video"].includes(track.kind)
  );
  const totalBars = Math.max(
    ...selected.sections.map((section) => section.startBar + section.lengthBars - 1)
  );
  const playProgress = audio.hasLoadedAudio && (audio.status.durationSeconds ?? 0) > 0
    ? Math.min(100, ((audio.status.positionSeconds ?? 0) / (audio.status.durationSeconds ?? 1)) * 100)
    : 29;
  const previousSong = adjacentSong(demoSetlist, selected.id, -1);
  const nextSong = adjacentSong(demoSetlist, selected.id, 1);
  const transportBusy = Boolean(audio.status.countInActive);
  const transportPlaying = Boolean(audio.status.playing);

  return (
    <section className="studio-dashboard">
      <div className="dashboard-top">
        <div className="panel dashboard-setlist">
          <div className="dashboard-panel-head">
            <div>
              <h2>Setlist</h2>
              <span>{demoSetlist.songs.length} Songs · 42 min</span>
            </div>
            <div className="head-actions">
              <button className="primary compact" onClick={onImport}>
                <Plus size={14} /> Add Song
              </button>
              <button className="compact">Reorder</button>
              <button className="compact">•••</button>
            </div>
          </div>

          <div className="dashboard-song-row header">
            <span>#</span><span>Title</span><span>Artist</span><span>BPM</span><span>Key</span>
            <span>Time</span><span>Tracks</span><span>Lights</span><span>Video</span><span>MIDI</span><span>Status</span>
          </div>

          {demoSetlist.songs.map((song, index) => (
            <button
              key={song.id}
              className={selected.id === song.id ? "dashboard-song-row selected" : "dashboard-song-row"}
              onClick={() => onSelect(song)}
            >
              <span className="song-number">{index + 1}</span>
              <span className="song-title">{song.title}</span>
              <span>{song.artist}</span>
              <span>{song.bpm}</span>
              <span>{song.key}</span>
              <span>{fmt(song.durationSeconds)}</span>
              <span><i className="mini green" /></span>
              <span><i className="mini pink" /></span>
              <span><i className="mini blue" /></span>
              <span><i className="mini cyan" /></span>
              <span className="ready">Ready</span>
            </button>
          ))}
        </div>

        <div className="panel dashboard-now">
          <div className="dashboard-panel-head">
            <h2>Now Playing</h2>
          </div>
          <div className="now-song">
            <div className="album-art">
              <div className="album-glow" />
              <Music2 size={24} />
            </div>
            <div>
              <strong>{selected.title}</strong>
              <span>{selected.artist}</span>
              <span>Key: {selected.key} · BPM: {selected.bpm} · {selected.meter.join("/")}</span>
            </div>
          </div>
          <div className="now-progress">
            <div><span style={{ width: playProgress + "%" }} /></div>
            <small>
              {audio.hasLoadedAudio ? fmtClock(audio.status.positionSeconds ?? 0) : "1:24"} / {audio.hasLoadedAudio ? fmtClock(audio.status.durationSeconds ?? selected.durationSeconds) : fmt(selected.durationSeconds)}
            </small>
          </div>
          <div className="now-controls">
            <button
              disabled={!previousSong}
              onClick={() => previousSong && onSelect(previousSong)}
              aria-label="Previous song"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="play-square"
              onClick={() =>
                void (transportPlaying || transportBusy ? onPause() : onStart())
              }
              disabled={!audio.hasLoadedAudio}
              aria-label={
                transportBusy
                  ? "Cancel count-in"
                  : transportPlaying
                    ? "Pause"
                    : "Play"
              }
            >
              <Play size={19} fill="currentColor" />
            </button>
            <button
              disabled={!nextSong}
              onClick={() => nextSong && onSelect(nextSong)}
              aria-label="Next song"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="next-song-card">
            <small>NEXT SONG</small>
            <strong>{nextSong?.title ?? "End of Set"}</strong>
            <span>{nextSong ? nextSong.bpm + " BPM" : "No song queued"}</span>
          </div>
        </div>

        <div className="panel dashboard-master">
          <div className="dashboard-panel-head"><h2>Master</h2></div>
          <div className="master-meter-stage">
            {[0.72, 0.91, 0.82, audio.status.peakLeft ?? 0.42].map((level, index) => (
              <div className="vertical-meter" key={index}>
                <i style={{ height: (level * 100) + "%" }} />
              </div>
            ))}
            <div className="master-scale">
              <strong>-6.2 dB</strong>
              <span>0</span><span>-6</span><span>-12</span><span>-24</span><span>-60</span>
            </div>
          </div>
          <div className="master-actions">
            <button>M</button><button>DIM</button><button className="master-knob" aria-label="Master level" />
          </div>
        </div>

        <div className="panel dashboard-sync">
          <div className="dashboard-panel-head">
            <h2>Global Tempo & Sync</h2>
            <button className="bare">•••</button>
          </div>
          <label>
            <span>Tempo</span>
            <div className="sync-line"><strong>{selected.bpm.toFixed(1)}</strong><button>TAP</button></div>
          </label>
          <label>
            <span>Time Signature</span>
            <div className="sync-signature"><strong>{selected.meter[0]}</strong><b>/</b><strong>{selected.meter[1]}</strong></div>
          </label>
          <label>
            <span>Song Start Count-In</span>
            <div className="segmented">
              <button
                className={selected.countIn.mode === "none" ? "active" : ""}
                onClick={() =>
                  onSongChange({ ...selected, countIn: { mode: "none" } })
                }
              >
                Off
              </button>
              <button
                className={
                  selected.countIn.mode === "bars" &&
                  selected.countIn.value === 1
                    ? "active"
                    : ""
                }
                onClick={() =>
                  onSongChange({
                    ...selected,
                    countIn: { mode: "bars", value: 1 }
                  })
                }
              >
                1 Bar
              </button>
              <button
                className={
                  selected.countIn.mode === "bars" &&
                  selected.countIn.value === 2
                    ? "active"
                    : ""
                }
                onClick={() =>
                  onSongChange({
                    ...selected,
                    countIn: { mode: "bars", value: 2 }
                  })
                }
              >
                2 Bars
              </button>
              <button
                className={
                  selected.countIn.mode === "beats" &&
                  selected.countIn.value === 4
                    ? "active"
                    : ""
                }
                onClick={() =>
                  onSongChange({
                    ...selected,
                    countIn: { mode: "beats", value: 4 }
                  })
                }
              >
                4 Beats
              </button>
            </div>
          </label>
          <div className="sync-toggle">
            <span>Manual Jumps: {selected.manualJumpCountIn.mode === "adaptive" ? "Adaptive Count" : "No Count"}</span>
            <i className={selected.manualJumpCountIn.mode === "adaptive" ? "on" : ""} />
          </div>
          <div className="sync-toggle"><span>Follow Song Tempo</span><i className="on" /></div>
        </div>
      </div>

      <div className="panel dashboard-arrangement">
        <div className="arrangement-toolbar">
          <div className="arrangement-title">
            <h2>Song Arrangement</h2>
            <span>{selected.title}⌄</span>
          </div>
          <div className="arrangement-tools">
            <button onClick={onOpenArrangement}>Edit</button>
            <button>Zoom −</button><button>Zoom +</button><button>Snap: Bar⌄</button>
          </div>
        </div>

        <div className="arrangement-shell">
          <div className="dashboard-timeline">
            <div className="timeline-clock">
              <span>0:00</span><span>0:30</span><span>1:00</span><span>1:30</span><span>2:00</span><span>2:30</span><span>3:00</span><span>4:00</span><span>{fmt(selected.durationSeconds)}</span>
            </div>
            <div className="dashboard-ruler">
              {selected.sections.map((section) => (
                <div
                  key={section.id}
                  style={{ flex: section.lengthBars, background: section.color }}
                >
                  {section.name.toUpperCase()}
                </div>
              ))}
            </div>
            {displayedTracks.map((track, index) => (
              <div className="dashboard-track" key={track.id}>
                <div className="dashboard-track-label">
                  <button>S</button><button>M</button>
                  <i style={{ background: track.color }} />
                  <span>{track.name}</span>
                </div>
                <div className={"dashboard-lane lane-" + track.kind}>
                  {track.kind === "lighting" ? (
                    <LightingAutomation />
                  ) : track.kind === "video" ? (
                    <VideoLane />
                  ) : (
                    <Waveform seed={index + 8} color={track.color} />
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="dashboard-section-inspector">
            <div className="inspector-tabs"><button>Song</button><button className="active">Section</button></div>
            <Field label="Section Name" value="Chorus 1" />
            <Field label="Start" value="57.1.1" />
            <Field label="End" value="73.1.1" />
            <Field label="Length" value="16 bars" />
            <Field label="Tempo" value="Follow Song" />
            <Field label="Signature" value={selected.meter.join("/")} />
            <Field label="Lighting Cue" value="Chorus Wide" />
            <Field label="MIDI Patch" value="12 · Chorus" />
            <Field label="Video Background" value="03" />
            <button className="duplicate-section">Duplicate Section</button>
          </div>
        </div>
      </div>

      <div className="dashboard-bottom">
        <div className="panel dashboard-pads">
          <div className="dashboard-panel-head">
            <h2>Pads</h2><button className="bare">•••</button>
          </div>
          <div className="mini-bank-tabs"><button className="active">Bank A</button><button>Bank B</button><button>Bank C</button><button>+</button></div>
          <div className="mini-pad-grid">
            {["Kick","Snare","Clap","Hat","Perc","Ride","Crash","Atmos","Bass","Piano","FX","Vocal"].map((name, index) => (
              <button key={name} style={{ "--pad-color": ["#fb5c72","#f4ce53","#38e0b7","#36d2d7","#8058ef","#65a4ff","#46bfd7","#8f68ff","#fb5b72","#32d5bf","#8a58ef","#e65ad4"][index] } as CSSProperties}>
                <span>{index + 1}</span><strong>{name}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="panel dashboard-mini-mixer">
          <div className="dashboard-panel-head">
            <h2>Mixer</h2>
            <span>🔒</span>
          </div>
          <div className="mini-mixer-channels">
            {displayedTracks.filter((track) => !["midi","lighting","video"].includes(track.kind)).slice(0, 7).map((track, index) => (
              <div className="mini-channel" key={track.id}>
                <strong>{track.name}</strong>
                <i className="channel-accent" style={{ background: track.color }} />
                <div className="mini-meter"><span style={{ height: (38 + (index * 11) % 54) + "%" }} /></div>
                <div className="mini-fader"><i style={{ bottom: (26 + (index * 7) % 48) + "%" }} /></div>
                <div className="mini-channel-actions"><button>S</button><button>M</button></div>
              </div>
            ))}
            <div className="mini-channel master">
              <strong>Master</strong><i className="channel-accent" />
              <div className="mini-meter"><span style={{ height: "82%" }} /></div>
              <div className="mini-fader"><i style={{ bottom: "48%" }} /></div>
              <div className="mini-channel-actions"><button>S</button><button>M</button></div>
            </div>
          </div>
        </div>

        <div className="panel dashboard-connections">
          <div className="dashboard-panel-head"><h2>Connections</h2><button className="bare">↗</button></div>
          {[
            ["Audio", audio.status.deviceName ?? "Default Output", audio.status.initialized],
            ["MIDI", "IAC Driver", true],
            ["LumaRig", "192.168.1.50", true],
            ["Video", "NDI", true],
            ["Remote", "iPad", true]
          ].map(([name, detail, ok]) => (
            <div className="connection-line" key={String(name)}>
              <span className="connection-icon">{String(name).slice(0,1)}</span>
              <strong>{String(name)} <small>({String(detail)})</small></strong>
              <span className={ok ? "conn-ready" : "conn-idle"}>{ok ? "Connected" : "Idle"}</span>
            </div>
          ))}
        </div>

        <div className="panel dashboard-shortcuts">
          <div className="dashboard-panel-head"><h2>Shortcuts</h2><button className="bare">•••</button></div>
          {[
            ["Space", "Play / Stop"],
            ["→", "Next Section"],
            ["←", "Previous Section"],
            ["⌘ + 1", "Go to Section 1"],
            ["⌘ + L", "Toggle Lights"],
            ["⌘ + M", "Toggle Metronome"]
          ].map(([key, action]) => (
            <div className="shortcut-line" key={key + action}><kbd>{key}</kbd><span>{action}</span></div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SongsPage({
  selected,
  onSelect,
  onOpenArrangement,
  onImport
}: {
  selected: Song;
  onSelect: (song: Song) => void;
  onOpenArrangement: () => void;
  onImport: () => void;
}) {
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Songs</h1>
          <p>Song library · arrangements, stems, sections and show-control data</p>
        </div>
        <button className="primary" onClick={onImport}><Plus size={16} /> Add Song</button>
      </div>

      <div className="songs-library">
        <div className="panel songs-list">
          <div className="song-library-head">
            <strong>Library</strong>
            <input placeholder="Search songs" aria-label="Search songs" />
          </div>
          {demoSetlist.songs.map((song) => (
            <button
              key={song.id}
              className={song.id === selected.id ? "library-song selected" : "library-song"}
              onClick={() => onSelect(song)}
            >
              <div className="library-art"><Music2 size={16} /></div>
              <div>
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
              </div>
              <span>{song.bpm} BPM</span>
              <span>{song.key}</span>
              <span>{fmt(song.durationSeconds)}</span>
            </button>
          ))}
        </div>

        <div className="panel song-library-detail">
          <small>SELECTED SONG</small>
          <h2>{selected.title}</h2>
          <p>{selected.artist}</p>
          <div className="library-meta">
            <Field label="Tempo" value={selected.bpm + " BPM"} />
            <Field label="Key" value={selected.key} />
            <Field label="Meter" value={selected.meter.join("/")} />
            <Field label="Length" value={fmt(selected.durationSeconds)} />
          </div>
          <div className="library-readiness">
            {[
              ["Audio", selected.tracks.some((track) => !["midi","lighting","video"].includes(track.kind))],
              ["Sections", selected.sections.length > 0],
              ["MIDI", selected.tracks.some((track) => track.kind === "midi")],
              ["Lighting", selected.tracks.some((track) => track.kind === "lighting")],
              ["Video", selected.tracks.some((track) => track.kind === "video")]
            ].map(([label, ready]) => (
              <div key={String(label)}>
                <span className={ready ? "dot ok" : "dot bad"} />
                <strong>{String(label)}</strong>
                <span>{ready ? "Ready" : "Not configured"}</span>
              </div>
            ))}
          </div>
          <button className="primary wide" onClick={onOpenArrangement}>
            Open Arrangement
          </button>
        </div>
      </div>
    </section>
  );
}

function Arrangement({
  song,
  onSongChange
}: {
  song: Song;
  onSongChange: (song: Song) => void;
}) {
  const [selectedSectionIndex, setSelectedSectionIndex] = useState(
    Math.min(4, Math.max(0, song.sections.length - 1))
  );
  const selectedSection =
    song.sections[Math.min(selectedSectionIndex, song.sections.length - 1)];
  const totalBars = Math.max(
    ...song.sections.map((section) => section.startBar + section.lengthBars - 1)
  );

  function setSongCountIn(settings: CountInSettings) {
    onSongChange({ ...song, countIn: settings });
  }

  function setManualJumpCountIn(settings: CountInSettings) {
    onSongChange({ ...song, manualJumpCountIn: settings });
  }

  function setSectionCountIn(settings?: CountInSettings) {
    onSongChange({
      ...song,
      sections: song.sections.map((section, index) =>
        index === selectedSectionIndex
          ? { ...section, countInOverride: settings }
          : section
      )
    });
  }

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

      <div className="count-in-settings panel">
        <div>
          <small>SONG START</small>
          <strong>Count-In</strong>
          <span>Establish tempo before beat 1. This pre-roll does not move the Song timeline.</span>
        </div>
        <div className="count-options">
          <button
            className={song.countIn.mode === "none" ? "active" : ""}
            onClick={() => setSongCountIn({ mode: "none" })}
          >
            Off
          </button>
          <button
            className={song.countIn.mode === "bars" && song.countIn.value === 1 ? "active" : ""}
            onClick={() => setSongCountIn({ mode: "bars", value: 1 })}
          >
            1 Bar
          </button>
          <button
            className={song.countIn.mode === "bars" && song.countIn.value === 2 ? "active" : ""}
            onClick={() => setSongCountIn({ mode: "bars", value: 2 })}
          >
            2 Bars
          </button>
          <button
            className={song.countIn.mode === "beats" && song.countIn.value === 4 ? "active" : ""}
            onClick={() => setSongCountIn({ mode: "beats", value: 4 })}
          >
            4 Beats
          </button>
        </div>
        <div className="manual-jump-setting">
          <small>MANUAL SECTION JUMP</small>
          <button
            className={song.manualJumpCountIn.mode === "adaptive" ? "active" : ""}
            onClick={() =>
              setManualJumpCountIn({ mode: "adaptive", minBeats: 2 })
            }
          >
            Adaptive
          </button>
          <button
            className={song.manualJumpCountIn.mode === "none" ? "active" : ""}
            onClick={() => setManualJumpCountIn({ mode: "none" })}
          >
            No Count
          </button>
        </div>
      </div>

      <div className="timeline panel">
        <div className="section-ruler">
          <div className="track-label ruler-label">SECTIONS</div>
          <div className="ruler-content">
            {song.sections.map((section, index) => (
              <button
                key={section.id}
                className={
                  index === selectedSectionIndex
                    ? "section-block selected"
                    : "section-block"
                }
                onClick={() => setSelectedSectionIndex(index)}
                style={{
                  width: (section.lengthBars / totalBars * 100) + "%",
                  background: section.color
                }}
              >
                {section.name}
              </button>
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

      {selectedSection && (
        <div className="inspector panel">
          <div>
            <small>SECTION</small>
            <strong>{selectedSection.name}</strong>
            <span>
              Bars {selectedSection.startBar}–
              {selectedSection.startBar + selectedSection.lengthBars - 1} ·
              {selectedSection.lengthBars} bars
            </span>
          </div>
          <Field label="Lighting Cue" value={selectedSection.lightingCue ?? "None"} />
          <Field label="MIDI Patch" value={selectedSection.midiPatch ?? "None"} />
          <Field label="Video" value={selectedSection.videoCue ?? "None"} />
          <Field label="Follow" value="Automatic Timeline" />

          <div className="section-count-editor">
            <small>MANUAL JUMP COUNT-IN</small>
            <div>
              <button
                className={!selectedSection.countInOverride ? "active" : ""}
                onClick={() => setSectionCountIn(undefined)}
              >
                Song Default
              </button>
              <button
                className={selectedSection.countInOverride?.mode === "none" ? "active" : ""}
                onClick={() => setSectionCountIn({ mode: "none" })}
              >
                None
              </button>
              <button
                className={
                  selectedSection.countInOverride?.mode === "bars" &&
                  selectedSection.countInOverride.value === 1
                    ? "active"
                    : ""
                }
                onClick={() => setSectionCountIn({ mode: "bars", value: 1 })}
              >
                1 Bar
              </button>
              <button
                className={
                  selectedSection.countInOverride?.mode === "beats" &&
                  selectedSection.countInOverride.value === 4
                    ? "active"
                    : ""
                }
                onClick={() => setSectionCountIn({ mode: "beats", value: 4 })}
              >
                4 Beats
              </button>
            </div>
          </div>
        </div>
      )}
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
  nextSong,
  onNextSong,
  remoteOnline,
  remoteClients,
  audio,
  queuedManualSection,
  onLaunchSection
}: {
  song: Song;
  current: number;
  nextSong: Song | null;
  onNextSong: (song: Song) => void;
  remoteOnline: boolean;
  remoteClients: number;
  audio: AudioEngineController;
  queuedManualSection: number | null;
  onLaunchSection: (index: number) => void;
}) {
  const active = song.sections[Math.min(current, song.sections.length - 1)];
  const automaticNextIndex = Math.min(current + 1, song.sections.length - 1);
  const nextIndex = queuedManualSection ?? automaticNextIndex;
  const next = song.sections[nextIndex];
  const musicalPosition = musicalPositionAtSeconds(
    song,
    audio.status.positionSeconds ?? sectionStartSeconds(song, current)
  );
  const countActive = Boolean(audio.status.countInActive);
  const queued = queuedManualSection !== null
    ? song.sections[queuedManualSection]
    : null;

  return (
    <section className="performance-page">
      <div className="page-head">
        <div>
          <h1>Performance</h1>
          <p>
            {song.title} · {song.bpm} BPM · {song.key} · Sections follow the timeline automatically
          </p>
        </div>
        <span className="performance-lock">
          <Activity size={15} /> LIVE SAFE
        </span>
      </div>

      <div className="section-strip panel">
        {song.sections.map((section, index) => (
          <button
            key={section.id}
            className={
              index === current
                ? "section-card current"
                : index === queuedManualSection
                  ? "section-card queued"
                  : "section-card"
            }
            onClick={() => onLaunchSection(index)}
          >
            <strong>{section.name}</strong>
            <span>
              {index === queuedManualSection
                ? "Queued override"
                : section.lengthBars + " Bars"}
            </span>
          </button>
        ))}
      </div>

      {countActive && (
        <div className="count-in-live panel">
          <div>
            <small>MANUAL TRANSITION</small>
            <strong>{queued ? "→ " + queued.name : "COUNT-IN"}</strong>
          </div>
          <div className="count-number">
            {audio.status.countInBeat
              ? audio.status.countInBeat
              : "•"}
            <span>/ {audio.status.countInTotal ?? 0}</span>
          </div>
          <p>Landing on beat 1</p>
        </div>
      )}

      <div className="performance-grid">
        <div className="hero-cue panel">
          <small>CURRENT SECTION · AUTO</small>
          <h2>{active.name}</h2>
          <p>
            Bar {musicalPosition.bar} · Beat {musicalPosition.beat} ·
            {musicalPosition.bpm} BPM
          </p>
          <div className="hero-progress">
            <span
              style={{
                width:
                  Math.min(
                    100,
                    ((musicalPosition.bar - active.startBar +
                      (musicalPosition.beat - 1) / musicalPosition.meter[0]) /
                      Math.max(1, active.lengthBars)) *
                      100
                  ) + "%"
              }}
            />
          </div>
        </div>
        <div className="next-cue panel">
          <small>{queued ? "QUEUED OVERRIDE" : "NEXT SECTION · AUTO"}</small>
          <h3>{next.name}</h3>
          <p>
            {queued
              ? "Count-in calculated from the current beat"
              : next.lengthBars + " bars"}
          </p>
        </div>
        <div className="live-status panel">
          <h3>Live Status</h3>
          <Status
            label={countActive ? "Count-In Active" : "Timeline Auto-Follow"}
          />
          <Status label="Audio Engine" ok={!audio.status.deviceError} />
          <Status label="MIDI Clock" ok={false} />
          <Status
            label={
              remoteClients > 0
                ? "Remote · " + remoteClients + " connected"
                : "Remote"
            }
            ok={remoteOnline}
          />
        </div>
      </div>

      <div className="go-row">
        <button
          disabled={current <= 0 || countActive}
          onClick={() => onLaunchSection(Math.max(0, current - 1))}
        >
          <ChevronLeft /> Previous Section
        </button>
        <button
          className="go"
          disabled={countActive || current >= song.sections.length - 1}
          onClick={() => onLaunchSection(automaticNextIndex)}
        >
          GO
          <small>MANUAL OVERRIDE</small>
        </button>
        <button
          disabled={countActive || current >= song.sections.length - 1}
          onClick={() => onLaunchSection(automaticNextIndex)}
        >
          Jump Next <ChevronRight />
        </button>
      </div>

      <div className="auto-follow-note">
        Normal playback changes sections automatically. Use the section strip or
        GO only when you want to override the arrangement.
      </div>

      <div className="song-advance panel">
        <div>
          <small>NEXT SONG</small>
          <strong>{nextSong?.title ?? "End of Set"}</strong>
          <span>
            {nextSong
              ? nextSong.artist + " · " + nextSong.bpm + " BPM · " + nextSong.key +
                " · " + countInLabel(nextSong)
              : "No song queued after this one"}
          </span>
        </div>
        <button
          className="next-song-control"
          disabled={!nextSong}
          onClick={() => nextSong && onNextSong(nextSong)}
        >
          NEXT SONG <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}

function countInLabel(song: Song) {
  if (song.countIn.mode === "none") return "No count-in";
  if (song.countIn.mode === "bars") {
    const bars = song.countIn.value ?? 1;
    return bars + (bars === 1 ? " bar count-in" : " bars count-in");
  }
  if (song.countIn.mode === "beats") {
    return (song.countIn.value ?? song.meter[0]) + " beat count-in";
  }
  return "Adaptive count-in";
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

function Sources({
  audio,
  onLoaded
}: {
  audio: AudioEngineController;
  onLoaded: (tracks: NativeAudioTrack[], status: NativeAudioStatus) => void;
}) {
  async function loadMultitrack() {
    const result = await audio.chooseAndLoad();
    if (result) onLoaded(result.tracks, result.status);
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Sources</h1>
          <p>Local multitracks, licensed media and reference playback</p>
        </div>
        <button
          className="primary"
          disabled={audio.busy}
          onClick={() => void loadMultitrack()}
        >
          <Upload size={16} />
          {audio.busy ? "Loading…" : "Load WAV Stems"}
        </button>
      </div>

      {audio.error && <div className="audio-error panel">{audio.error}</div>}

      <div className="sources-grid">
        <div className="panel source-card source-card-primary">
          <AudioLines size={28} />
          <div>
            <small>REALTIME AUDIO</small>
            <h2>Local Multitrack</h2>
            <p>
              Select aligned WAV stems. LumaRig Studio normalizes them to the
              hardware sample rate before playback and starts every stem from
              the same musical frame.
            </p>
          </div>
          <button className="primary" onClick={() => void loadMultitrack()}>
            Choose WAV Files
          </button>
        </div>

        <div className="panel source-card">
          <Clapperboard size={28} />
          <div>
            <small>REFERENCE ONLY</small>
            <h2>YouTube Reference</h2>
            <p>
              Keep a rehearsal or arrangement reference beside the song.
              Pitch processing, stem splitting and local warping stay on
              licensed or local media.
            </p>
          </div>
          <input
            className="source-input"
            placeholder="Paste YouTube reference URL"
            aria-label="YouTube reference URL"
          />
        </div>

        <div className="panel engine-card">
          <div className="card-head">
            <h3>Audio Engine</h3>
            <span className={audio.status.initialized ? "ready" : "muted"}>
              {audio.status.initialized ? "Online" : "Idle"}
            </span>
          </div>
          <Field label="Device" value={audio.status.deviceName ?? "Not initialized"} />
          <Field
            label="Sample Rate"
            value={audio.status.sampleRate ? audio.status.sampleRate.toLocaleString() + " Hz" : "—"}
          />
          <Field
            label="Tracks"
            value={String(audio.status.loadedTracks ?? 0)}
          />
          <Field
            label="Duration"
            value={fmtClock(audio.status.durationSeconds ?? 0)}
          />
        </div>
      </div>

      {audio.tracks.length > 0 && (
        <div className="panel imported-tracks">
          <div className="card-head">
            <h3>Loaded Tracks</h3>
            <span>{audio.tracks.length} aligned stems</span>
          </div>
          {audio.tracks.map((track, index) => (
            <div className="imported-track" key={track.id}>
              <span>{index + 1}</span>
              <i style={{ background: track.color }} />
              <strong>{track.name}</strong>
              <span>{track.kind}</span>
              <code>{track.path}</code>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Mixer({
  song,
  audio
}: {
  song: Song;
  audio: AudioEngineController;
}) {
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const [soloTracks, setSoloTracks] = useState<Set<string>>(new Set());

  function toggleSet(
    current: Set<string>,
    id: string,
    setter: (value: Set<string>) => void
  ) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
    return next.has(id);
  }

  const audioTracks = song.tracks.filter(
    (track) => !["lighting", "video", "midi"].includes(track.kind)
  );

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Mixer</h1>
          <p>
            {song.title}
            {audio.hasLoadedAudio
              ? " · " + (audio.status.deviceName ?? "Native Output")
              : " · preview controls"}
          </p>
        </div>
        {audio.hasLoadedAudio && (
          <div className="master-readout">
            <span>L</span>
            <i style={{ width: ((audio.status.peakLeft ?? 0) * 100) + "%" }} />
            <span>R</span>
            <i style={{ width: ((audio.status.peakRight ?? 0) * 100) + "%" }} />
          </div>
        )}
      </div>

      <div className="mixer panel">
        {audioTracks.map((track, index) => {
          const live = audio.tracks.some((nativeTrack) => nativeTrack.id === track.id);
          const muted = mutedTracks.has(track.id);
          const solo = soloTracks.has(track.id);

          return (
            <div className="channel" key={track.id}>
              <strong style={{ color: track.color }}>{track.name}</strong>
              <div className="meter-bars">
                <i
                  style={{
                    height: live && index === 0
                      ? ((audio.status.peakLeft ?? 0) * 100) + "%"
                      : "12%"
                  }}
                />
                <i
                  style={{
                    height: live && index === 0
                      ? ((audio.status.peakRight ?? 0) * 100) + "%"
                      : "12%"
                  }}
                />
              </div>

              <input
                type="range"
                min="-60"
                max="6"
                step="0.5"
                defaultValue={track.gainDb}
                disabled={!live}
                onChange={(event) => {
                  if (live) {
                    void audio.setTrackGain(track.id, Number(event.currentTarget.value));
                  }
                }}
              />

              <span>{live ? "Native" : "No media"}</span>

              <div>
                <button
                  className={solo ? "channel-toggle active" : "channel-toggle"}
                  disabled={!live}
                  onClick={() => {
                    const next = toggleSet(soloTracks, track.id, setSoloTracks);
                    void audio.setTrackSolo(track.id, next);
                  }}
                >
                  S
                </button>
                <button
                  className={muted ? "channel-toggle active danger" : "channel-toggle"}
                  disabled={!live}
                  onClick={() => {
                    const next = toggleSet(mutedTracks, track.id, setMutedTracks);
                    void audio.setTrackMuted(track.id, next);
                  }}
                >
                  M
                </button>
              </div>
            </div>
          );
        })}
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

function Connections({
  audio,
  remote
}: {
  audio: AudioEngineController;
  remote: ReturnType<typeof useRemoteRelay>;
}) {
  const cards = [
    [
      "Audio I/O",
      audio.status.deviceName ?? "Default system output",
      audio.status.sampleRate
        ? audio.status.sampleRate.toLocaleString() + " Hz · native engine"
        : "Initialize by loading a multitrack"
    ],
    ["MIDI", "LumaRig MIDI (Virtual)", "Clock + Start/Stop"],
    ["Clock Sync", "Internal (LumaRig)", "Song tempo"],
    ["Lighting", "LumaRig / Art-Net", "Runtime comes in Phase 4"],
    ["Network", "Supabase Realtime", "Studio owns the remote relay session"]
  ];

  const pairCode = remote.session?.pairCode ?? "------";
  const pairExpires = remote.session
    ? new Date(remote.session.pairExpiresAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
      })
    : null;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Connections</h1>
          <p>Audio, MIDI, lighting, network and remote integrations</p>
        </div>
        <span className={remote.status === "online" ? "ready" : "muted"}>
          <span className={remote.status === "online" ? "dot ok" : "dot bad"} />
          Remote {remote.status}
        </span>
      </div>

      <div className="panel remote-pairing-card">
        <div>
          <small>REMOTE CONTROL</small>
          <h2>Pair iPad or iPhone</h2>
          <p>
            LumaRig Studio creates and owns this session. The remote only joins
            after you enter the pairing code. New Pair Code keeps connected
            remotes online. Reset Session revokes the current session.
          </p>
        </div>

        <div className="pair-code-block">
          <span>PAIR CODE</span>
          <strong>{pairCode}</strong>
          <small>{pairExpires ? "Valid until " + pairExpires : "Creating secure session…"}</small>
        </div>

        <div className="remote-pair-actions">
          <span className={remote.status === "online" ? "ready" : "muted"}>
            {remote.status === "online"
              ? remote.remoteClients > 0
                ? remote.remoteClients + (remote.remoteClients === 1 ? " remote connected" : " remotes connected")
                : "Ready for remote"
              : "Relay " + remote.status}
          </span>
          <div className="remote-session-buttons">
            <button onClick={() => void remote.rotatePairCode()}>New Pair Code</button>
            <button onClick={() => void remote.restart()}>Reset Session</button>
          </div>
        </div>
      </div>

      {remote.error && <div className="audio-error panel">{remote.error}</div>}

      <div className="connection-grid">
        {cards.map(([title, value, detail], index) => (
          <div className="panel connection-card" key={title}>
            <div className="card-head">
              <h3>{title}</h3>
              <span
                className={
                  title === "Audio I/O" && !audio.status.initialized
                    ? "muted"
                    : title === "Network" && remote.status !== "online"
                      ? "muted"
                      : title === "MIDI" || title === "Lighting"
                        ? "muted"
                        : "ready"
                }
              >
                {title === "Audio I/O"
                  ? audio.status.initialized ? "Connected" : "Idle"
                  : title === "Network"
                    ? remote.status === "online" ? "Online" : "Offline"
                    : title === "MIDI" || title === "Lighting"
                      ? "Planned"
                      : "Configured"}
              </span>
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

function SettingsPage({ audio }: { audio: AudioEngineController }) {
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
          <Field
            label="Sample Rate"
            value={audio.status.sampleRate
              ? audio.status.sampleRate.toLocaleString() + " Hz"
              : "Device default"}
          />
          <Field
            label="Audio Device"
            value={audio.status.deviceName ?? "Not initialized"}
          />
          <Field
            label="Loaded Tracks"
            value={String(audio.status.loadedTracks ?? 0)}
          />
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

function ImportWizard({
  audio,
  onNativeLoaded,
  onClose
}: {
  audio: AudioEngineController;
  onNativeLoaded: (tracks: NativeAudioTrack[], status: NativeAudioStatus) => void;
  onClose: () => void;
}) {
  const steps: ImportStep[] = ["source", "analyze", "stems", "sections", "review"];
  const [step, setStep] = useState<ImportStep>("source");
  const index = steps.indexOf(step);
  const next = () => setStep(steps[Math.min(steps.length - 1, index + 1)]);

  async function importMultitrack() {
    const result = await audio.chooseAndLoad();
    if (result) onNativeLoaded(result.tracks, result.status);
  }

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
              <button
                className="primary"
                disabled={audio.busy}
                onClick={() => void importMultitrack()}
              >
                {audio.busy ? "Loading…" : "Choose WAV Stems"}
              </button>
            </div>
            {audio.error && <div className="audio-error">{audio.error}</div>}
            <div className="source-options">
              <button disabled={audio.busy} onClick={() => void importMultitrack()}>
                <Upload />
                <strong>Import Multitrack</strong>
                <span>Aligned WAV stems · real native playback</span>
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
