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
import { createProject } from "../domain/project";
import { openProject, saveProject } from "../services/projectStore";
import { chooseLocalVideo, createYouTubeClip } from "../services/video";
import type { VideoClip, VideoProgram } from "../domain/video";
import { VideoProgram as VideoProgramRenderer } from "../components/VideoProgram";
import type { BuildTool, CountInSettings, ImportStep, Page, Setlist, ShowTool, Song, Workspace } from "../domain/types";
import { adjacentSong } from "../domain/setlist";
import {
  buildAutomaticGuideTimeline,
  countPulseForSection,
  planGuideCount,
  planSongStartGuide
} from "../domain/guideVoice";
import {
  musicalPositionAtSeconds,
  planManualSectionJump,
  planSongCountIn,
  sectionIndexAtSeconds,
  sectionStartSeconds
} from "../domain/timing";
import { useRemoteRelay } from "../hooks/useRemoteRelay";
import { useLumaRig } from "../hooks/useLumaRig";
import { loopbackLumaRigPeer } from "../lumarig/discovery";
import type { RemoteCommandEnvelope } from "../remote/protocol";
import { buildRemoteStudioState } from "../remote/state";
import { checkForAppUpdate } from "../services/updater";
import { useAudioEngine, type AudioEngineController } from "../hooks/useAudioEngine";
import type { NativeAudioStatus, NativeAudioTrack } from "../services/audio";
import { choosePadAudio, configureNativePad, loadNativePad, releaseNativePad, stopNativePad, triggerNativePad, type PadSlot } from "../services/pads";

const workspaceNav: Array<{ page: Workspace; label: string; icon: typeof Music2 }> = [
  { page: "import", label: "Import", icon: Upload },
  { page: "build", label: "Build", icon: WandSparkles },
  { page: "show", label: "Show", icon: ListMusic },
  { page: "live", label: "Live", icon: Play }
];

const buildNav: Array<{ tool: BuildTool; label: string; icon: typeof Music2 }> = [
  { tool: "arrangement", label: "Arrangement", icon: AudioLines },
  { tool: "mixer", label: "Mixer", icon: SlidersHorizontal },
  { tool: "pads", label: "Pads", icon: Grid2X2 },
  { tool: "lighting", label: "Lighting", icon: Lightbulb },
  { tool: "midi", label: "MIDI", icon: Radio },
  { tool: "video", label: "Video / NDI", icon: Clapperboard }
];

const showNav: Array<{ tool: ShowTool; label: string; icon: typeof Music2 }> = [
  { tool: "setlist", label: "Setlist", icon: ListMusic },
  { tool: "connections", label: "Connections", icon: Cable },
  { tool: "settings", label: "Settings", icon: Settings }
];

function fmt(seconds: number) {
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

export function App() {
  const [page, setPage] = useState<Page>("show");
  const [buildTool, setBuildTool] = useState<BuildTool>("arrangement");
  const [showTool, setShowTool] = useState<ShowTool>("setlist");
  const [project, setProject] = useState(() => createProject("Sunday Set", demoSetlist.songs));
  const [projectPath, setProjectPath] = useState<string | undefined>();
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
      setProject((current) => ({ ...current, selectedSongId: song.id, updatedAt: new Date().toISOString() }));
      setCurrentSection(0);
    },
    [audio.hasLoadedAudio, audio.stop]
  );

  const startPlayback = useCallback(async () => {
    if (!audio.hasLoadedAudio) {
      setPreviewPlaying(true);
      return;
    }

    if (audio.status.transitionActive) return;
    if (audio.status.playing) return;

    const position = audio.status.positionSeconds ?? 0;
    if (position <= 0.05) {
      const countIn = planSongCountIn(selectedSong);

      if (countIn.countBeats > 0) {
        const guidePlan = planSongStartGuide(selectedSong);
        const voiceEnabled =
          selectedSong.guideVoice.outputMode === "voice-and-click" ||
          selectedSong.guideVoice.outputMode === "voice-only";
        const clickEnabled =
          selectedSong.guideVoice.outputMode === "voice-and-click" ||
          selectedSong.guideVoice.outputMode === "click-only";

        await audio.scheduleTransition({
          targetSeconds: countIn.targetSeconds,
          delaySeconds: countIn.launchAfterSeconds,
          firstCountDelaySeconds: 0,
          beatSeconds: countIn.beatSeconds,
          countBeats: countIn.countBeats,
          pulsesPerBar: countIn.pulsesPerBar,
          clickEnabled,
          keepAudio: false,
          guideEvents: voiceEnabled
            ? guidePlan.events.map((event) => ({
                offsetPulses: event.offsetPulses,
                token: event.token
              }))
            : []
        });
        return;
      }

      if (countIn.targetSeconds > 0) {
        await audio.seek(countIn.targetSeconds);
      }
    }

    await audio.playPause();
  }, [
    audio.hasLoadedAudio,
    audio.playPause,
    audio.scheduleTransition,
    audio.seek,
    audio.status.transitionActive,
    audio.status.playing,
    audio.status.positionSeconds,
    selectedSong
  ]);

  const pausePlayback = useCallback(async () => {
    if (!audio.hasLoadedAudio) {
      setPreviewPlaying(false);
      return;
    }

    if (audio.status.transitionActive) {
      await audio.cancelTransition();
      setQueuedManualSection(null);
      return;
    }

    if (audio.status.playing) {
      await audio.playPause();
    }
  }, [
    audio.cancelTransition,
    audio.hasLoadedAudio,
    audio.playPause,
    audio.status.transitionActive,
    audio.status.playing
  ]);

  const stopPlayback = useCallback(async () => {
    if (audio.hasLoadedAudio) {
      await audio.stop();
    }
    setPreviewPlaying(false);
    setQueuedManualSection(null);
    setCurrentSection(0);
  }, [audio.hasLoadedAudio, audio.stop]);

  const launchSection = useCallback(
    async (index: number) => {
      const target = selectedSong.sections[index];
      if (!target) return;

      if (audio.hasLoadedAudio && audio.status.playing) {
        if (audio.status.transitionActive) {
          await audio.cancelTransition();
        }

        const position = audio.status.positionSeconds ?? 0;
        const plan = planManualSectionJump(selectedSong, position, target);
        const pulse = countPulseForSection(selectedSong, target);
        const guidePlan = planGuideCount({
          destination: target,
          totalCountPulses: plan.countBeats,
          pulsesPerBar: pulse.pulsesPerBar,
          announceSection: true,
          voiceFinalBarOnly: selectedSong.guideVoice.voiceFinalBarOnly
        });
        const voiceEnabled =
          selectedSong.guideVoice.outputMode === "voice-and-click" ||
          selectedSong.guideVoice.outputMode === "voice-only";
        const clickEnabled =
          selectedSong.guideVoice.outputMode === "voice-and-click" ||
          selectedSong.guideVoice.outputMode === "click-only";

        setQueuedManualSection(index);
        await audio.scheduleTransition({
          targetSeconds: plan.targetSeconds,
          delaySeconds: plan.launchAfterSeconds,
          firstCountDelaySeconds: plan.firstCountAfterSeconds,
          beatSeconds: plan.beatSeconds,
          countBeats: plan.countBeats,
          pulsesPerBar: plan.pulsesPerBar,
          clickEnabled,
          keepAudio: true,
          guideEvents: voiceEnabled
            ? guidePlan.events.map((event) => ({
                offsetPulses: event.offsetPulses,
                token: event.token
              }))
            : []
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
      audio.cancelTransition,
      audio.hasLoadedAudio,
      audio.scheduleTransition,
      audio.seek,
      audio.status.transitionActive,
      audio.status.playing,
      audio.status.positionSeconds,
      selectedSong
    ]
  );

  useEffect(() => {
    if (!audio.hasLoadedAudio || !audio.status.playing) return;
    if (audio.status.transitionActive) return;

    const index = sectionIndexAtSeconds(
      selectedSong,
      audio.status.positionSeconds ?? 0
    );

    setCurrentSection((current) => (current === index ? current : index));
    setQueuedManualSection((queued) => (queued === index ? null : queued));
  }, [
    audio.hasLoadedAudio,
    audio.status.transitionActive,
    audio.status.playing,
    audio.status.positionSeconds,
    selectedSong
  ]);

  useEffect(() => {
    if (!audio.hasLoadedAudio) return;

    const voiceEnabled =
      selectedSong.guideVoice.outputMode === "voice-and-click" ||
      selectedSong.guideVoice.outputMode === "voice-only";
    const voicePackLoaded = Boolean(audio.status.voicePack?.id);

    const events =
      voiceEnabled && voicePackLoaded
        ? buildAutomaticGuideTimeline(selectedSong)
        : [];

    void audio.updateGuideTimeline(events);
  }, [
    audio.hasLoadedAudio,
    audio.status.voicePack?.id,
    audio.updateGuideTimeline,
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
          await stopPlayback();
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
            project.setlist,
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
          const song = project.setlist.songs.find((item) => item.id === id);
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
      stopPlayback,
      audio.setTrackGain,
      audio.setTrackMuted,
      audio.setTrackSolo,
      audio.status.playing,
      audio.stop,
      audio.tracks,
      selectSetlistSong,
      selectedSong.id,
      selectedSong.sections,
      project.setlist
    ]
  );

  const remoteState = useMemo(
    () =>
      buildRemoteStudioState({
        setlist: project.setlist,
        song: selectedSong,
        currentSectionIndex: currentSection,
        previewPlaying,
        audioStatus: audio.status,
        queuedSectionIndex: queuedManualSection
      }),
    [audio.status, currentSection, previewPlaying, queuedManualSection, selectedSong, project.setlist]
  );

  const remote = useRemoteRelay(remoteState, handleRemoteCommand);
  const lumarig = useLumaRig();

  useEffect(() => {
    setProject((current) => ({
      ...current,
      selectedSongId: selectedSong.id,
      updatedAt: new Date().toISOString(),
      setlist: {
        ...current.setlist,
        songs: current.setlist.songs.some((song) => song.id === selectedSong.id)
          ? current.setlist.songs.map((song) => song.id === selectedSong.id ? selectedSong : song)
          : [...current.setlist.songs, selectedSong]
      }
    }));
  }, [selectedSong]);

  async function saveCurrentProject(saveAs = false) {
    const path = await saveProject(project, saveAs ? undefined : projectPath);
    if (path) setProjectPath(path);
  }

  async function openStudioProject() {
    const opened = await openProject();
    if (!opened) return;
    setProject(opened.project);
    setProjectPath(opened.path);
    const song = opened.project.setlist.songs.find((item) => item.id === opened.project.selectedSongId)
      ?? opened.project.setlist.songs[0];
    if (song) {
      setSelectedSong(song);
      setCurrentSection(0);
      setQueuedManualSection(null);
    }
  }

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
          onStop={stopPlayback}
        />
        <div className="workspace">
          {page === "import" && (
            <Sources audio={audio} onLoaded={(tracks, status) => {
              applyNativeTracks(tracks, status);
              setBuildTool("arrangement");
              setPage("build");
            }} />
          )}

          {page === "build" && (
            <>
              <ToolRail
                items={buildNav}
                active={buildTool}
                onSelect={setBuildTool}
              />
              {buildTool === "arrangement" && <Arrangement song={selectedSong} onSongChange={setSelectedSong} />}
              {buildTool === "mixer" && <Mixer song={selectedSong} audio={audio} />}
              {buildTool === "pads" && <Pads initialPads={project.pads} initialPadCount={project.padCount} onChange={(pads, padCount) => setProject((current) => ({ ...current, pads, padCount, updatedAt: new Date().toISOString() }))} />}
              {buildTool === "lighting" && <Lighting song={selectedSong} lumarig={lumarig} />}
              {buildTool === "midi" && <UnavailableFeature title="MIDI" text="Native MIDI routing is being wired into the v0.3 runtime." />}
              {buildTool === "video" && <VideoEditor program={project.video} sections={selectedSong.sections} positionSeconds={audio.status.positionSeconds ?? 0} playing={Boolean(audio.status.playing || previewPlaying)} sectionId={selectedSong.sections[currentSection]?.id} onChange={(video) => setProject((current) => ({ ...current, video, updatedAt: new Date().toISOString() }))} />}
            </>
          )}

          {page === "show" && (
            <>
              <ToolRail
                items={showNav}
                active={showTool}
                onSelect={setShowTool}
              />
              {showTool === "setlist" && (
                <SetlistPage
                  selected={selectedSong}
                  setlist={project.setlist}
                  audio={audio}
                  onSelect={(song) => void selectSetlistSong(song)}
                  onOpenArrangement={() => { setBuildTool("arrangement"); setPage("build"); }}
                  onImport={() => setPage("import")}
                  onSongChange={setSelectedSong}
                  onStart={startPlayback}
                  onPause={pausePlayback}
                />
              )}
              {showTool === "connections" && <Connections audio={audio} remote={remote} lumarig={lumarig} song={selectedSong} onSongChange={setSelectedSong} />}
              {showTool === "settings" && <SettingsPage audio={audio} />
                <div className="panel project-actions">
                  <strong>{project.name}</strong>
                  <span>{projectPath ?? "Unsaved Studio Project"}</span>
                  <button onClick={() => void openStudioProject()}>Open Project</button>
                  <button onClick={() => void saveCurrentProject(false)}>Save Project</button>
                  <button onClick={() => void saveCurrentProject(true)}>Save As…</button>
                </div>}
            </>
          )}

          {page === "live" && (
            <Performance
              song={selectedSong}
              current={currentSection}
              nextSong={adjacentSong(project.setlist, selectedSong.id, 1)}
              onNextSong={(song) => void selectSetlistSong(song)}
              remoteOnline={remote.status === "online"}
              remoteClients={remote.remoteClients}
              audio={audio}
              queuedManualSection={queuedManualSection}
              onLaunchSection={(index) => void launchSection(index)}
            />
          )}
        </div>
      </main>
      {importOpen && (
        <ImportWizard
          audio={audio}
          onNativeLoaded={(tracks, status) => {
            applyNativeTracks(tracks, status);
            setImportOpen(false);
            setBuildTool("arrangement");
            setPage("build");
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
        <div><strong>LUMARIG</strong><span>STUDIO · BETA 0.3</span></div>
      </div>
      <nav className="workspace-nav">
        {workspaceNav.map(({ page: target, label, icon: Icon }) => (
          <button key={target} className={page === target ? "active" : ""} onClick={() => onPage(target)}>
            <Icon size={17} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom"><span>WORKFLOW</span><strong>IMPORT → BUILD → SHOW → LIVE</strong></div>
    </aside>
  );
}

function ToolRail<T extends string>({
  items,
  active,
  onSelect
}: {
  items: Array<{ tool: T; label: string; icon: typeof Music2 }>;
  active: T;
  onSelect: (tool: T) => void;
}) {
  return (
    <div className="tool-rail panel">
      {items.map(({ tool, label, icon: Icon }) => (
        <button key={tool} className={active === tool ? "active" : ""} onClick={() => onSelect(tool)}>
          <Icon size={15} /> {label}
        </button>
      ))}
    </div>
  );
}

function VideoEditor({ program, sections, positionSeconds, playing, sectionId, onChange }: { program?: VideoProgram; sections: Song["sections"]; positionSeconds: number; playing: boolean; sectionId?: string; onChange: (program: VideoProgram) => void }) {
  const value: VideoProgram = program ?? { clips: [], output: { displayEnabled: false, ndiEnabled: false, ndiName: "LumaRig Studio Program" } };
  const [selectedId, setSelectedId] = useState<string | null>(value.clips[0]?.id ?? null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [error, setError] = useState("");
  const selected = value.clips.find((clip) => clip.id === selectedId) ?? value.clips[0];

  function updateClip(id: string, patch: Partial<VideoClip>) {
    onChange({ ...value, clips: value.clips.map((clip) => clip.id === id ? { ...clip, ...patch } : clip) });
  }
  async function addLocal() {
    try { setError(""); const clip = await chooseLocalVideo(); if (!clip) return; onChange({ ...value, clips: [...value.clips, clip] }); setSelectedId(clip.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function addYouTube() {
    try { setError(""); const clip = createYouTubeClip(youtubeUrl); onChange({ ...value, clips: [...value.clips, clip] }); setSelectedId(clip.id); setYoutubeUrl(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  return <section className="video-editor">
    <div className="page-head"><div><h1>Video / NDI</h1><p>Timeline video, section cues and program output</p></div><button className="primary" onClick={() => void addLocal()}>Add MP4 / MOV</button></div>
    {error && <div className="error-banner">{error}</div>}
    <div className="panel video-source-add"><input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.currentTarget.value)} placeholder="Paste YouTube link" /><button onClick={addYouTube}>Add YouTube</button></div>
    <div className="video-editor-grid">
      <div className="panel video-library"><h2>Clips</h2>{value.clips.length === 0 && <p>No video clips yet.</p>}{value.clips.map((clip) => <button key={clip.id} className={clip.id === selected?.id ? "active" : ""} onClick={() => setSelectedId(clip.id)}><strong>{clip.name}</strong><span>{clip.source.kind === "local" ? clip.source.format.toUpperCase() : "YouTube"} · {clip.sourceInSeconds.toFixed(1)}s → {clip.sourceOutSeconds?.toFixed(1) ?? "end"}</span></button>)}</div>
      <div className="panel video-preview">
        <VideoProgramRenderer program={value} positionSeconds={positionSeconds} playing={playing} sectionId={sectionId} preview />
      </div>
      {selected && <div className="panel video-inspector"><h2>Clip Editor</h2>
        <label><span>Name</span><input value={selected.name} onChange={(e) => updateClip(selected.id,{name:e.currentTarget.value})}/></label>
        <label><span>Timeline Start</span><input type="number" min="0" step="0.1" value={selected.timelineStartSeconds} onChange={(e)=>updateClip(selected.id,{timelineStartSeconds:Number(e.currentTarget.value)})}/></label>
        <label><span>Source In</span><input type="number" min="0" step="0.1" value={selected.sourceInSeconds} onChange={(e)=>updateClip(selected.id,{sourceInSeconds:Number(e.currentTarget.value)})}/></label>
        <label><span>Source Out</span><input type="number" min="0" step="0.1" value={selected.sourceOutSeconds ?? ""} placeholder="End" onChange={(e)=>updateClip(selected.id,{sourceOutSeconds:e.currentTarget.value === "" ? undefined : Number(e.currentTarget.value)})}/></label>
        <label><span>Section</span><select value={selected.sectionId ?? ""} onChange={(e)=>updateClip(selected.id,{sectionId:e.currentTarget.value || undefined,playbackMode:e.currentTarget.value ? "section":"timeline"})}><option value="">Timeline</option>{sections.map((section)=><option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
        <label><span>Loop</span><input type="checkbox" checked={selected.loop} onChange={(e)=>updateClip(selected.id,{loop:e.currentTarget.checked})}/></label>
        <button onClick={()=>{onChange({...value,clips:value.clips.filter((clip)=>clip.id!==selected.id)});setSelectedId(null);}}>Remove Clip</button>
      </div>}
    </div>
    <div className="panel video-output"><h2>Program Output</h2>
      <label><input type="checkbox" checked={value.output.displayEnabled} onChange={(e)=>onChange({...value,output:{...value.output,displayEnabled:e.currentTarget.checked}})}/> External Display</label>
      <label><input type="checkbox" checked={value.output.ndiEnabled} onChange={(e)=>onChange({...value,output:{...value.output,ndiEnabled:e.currentTarget.checked}})}/> NDI</label>
      <input value={value.output.ndiName} onChange={(e)=>onChange({...value,output:{...value.output,ndiName:e.currentTarget.value}})} aria-label="NDI source name"/>
    </div>
  </section>;
}

function UnavailableFeature({ title, text }: { title: string; text: string }) {
  return (
    <section>
      <div className="page-head"><div><h1>{title}</h1><p>{text}</p></div></div>
      <div className="panel utility">
        <h2>Runtime not connected yet</h2>
        <p>{text} Controls stay disabled until the native provider is available.</p>
        <button className="primary" disabled>Unavailable in this build</button>
      </div>
    </section>
  );
}

function Transport({
  song,
  previewPlaying,
  onPreviewPlaying,
  audio,
  remoteOnline,
  onStart,
  onPause,
  onStop
}: {
  song: Song;
  previewPlaying: boolean;
  onPreviewPlaying: (value: boolean) => void;
  audio: AudioEngineController;
  remoteOnline: boolean;
  onStart: () => Promise<void>;
  onPause: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const playing = audio.hasLoadedAudio
    ? Boolean(audio.status.playing)
    : previewPlaying;
  const counting = Boolean(audio.status.countInActive);
  const transitionBusy = Boolean(audio.status.transitionActive);

  async function togglePlay() {
    if (playing || transitionBusy) {
      await onPause();
    } else {
      await onStart();
    }
  }

  async function stop() {
    await onStop();
  }

  const countLabel = counting
    ? audio.status.countInBeat
      ? "COUNT " + audio.status.countInBeat + "/" + (audio.status.countInTotal ?? 0)
      : "COUNT READY"
    : transitionBusy
      ? "JUMP QUEUED"
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
        className={playing || transitionBusy ? "transport-btn live" : "transport-btn"}
        onClick={() => void togglePlay()}
        aria-label={transitionBusy ? "Cancel queued transition" : playing ? "Pause" : "Play"}
      >
        <Play size={19} fill="currentColor" />
      </button>
      <button className="transport-btn" onClick={() => void stop()}>
        <CircleStop size={18} />
      </button>
      <div className={transitionBusy ? "quantize counting" : "quantize"}>{countLabel}</div>
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
  setlist,
  audio,
  onSelect,
  onOpenArrangement,
  onImport,
  onSongChange,
  onStart,
  onPause
}: {
  selected: Song;
  setlist: Setlist;
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
  const previousSong = adjacentSong(setlist, selected.id, -1);
  const nextSong = adjacentSong(setlist, selected.id, 1);
  const transportBusy = Boolean(audio.status.transitionActive);
  const transportPlaying = Boolean(audio.status.playing);

  return (
    <section className="studio-dashboard">
      <div className="dashboard-top">
        <div className="panel dashboard-setlist">
          <div className="dashboard-panel-head">
            <div>
              <h2>Setlist</h2>
              <span>{setlist.songs.length} Songs · 42 min</span>
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

          {setlist.songs.map((song, index) => (
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
          {setlist.songs.map((song) => (
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

  function setSectionDirectionCue(token?: string, label?: string) {
    if (!selectedSection) return;

    const markerId = "section-direction-" + selectedSection.id;
    const withoutCurrent = song.guideMarkers.filter(
      (marker) => marker.id !== markerId
    );

    onSongChange({
      ...song,
      guideMarkers: token
        ? [
            ...withoutCurrent,
            {
              id: markerId,
              bar: selectedSection.startBar,
              beat: 1,
              token,
              label
            }
          ]
        : withoutCurrent
    });
  }

  const selectedDirectionMarker = selectedSection
    ? song.guideMarkers.find(
        (marker) => marker.id === "section-direction-" + selectedSection.id
      )
    : undefined;

  const directionCues = [
    ["direction.last-time", "Last Time"],
    ["direction.one-more", "One More"],
    ["direction.two-more", "Two More"],
    ["direction.hold", "Hold"],
    ["direction.stop", "Stop"],
    ["direction.repeat", "Repeat"],
    ["direction.again", "Again"],
    ["direction.build", "Build"],
    ["direction.down", "Down"],
    ["direction.big", "Big"],
    ["direction.soft", "Soft"]
  ] as const;

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
          <label className="count-custom">
            <span>Custom</span>
            <input
              type="number"
              min="1"
              max="32"
              value={song.countIn.mode === "beats" ? song.countIn.value ?? 4 : 4}
              onChange={(event) =>
                setSongCountIn({
                  mode: "beats",
                  value: clampCountBeats(Number(event.currentTarget.value))
                })
              }
            />
          </label>
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

      <div className="guide-settings panel">
        <div>
          <small>GUIDE SYSTEM</small>
          <strong>Reusable Count + Voice</strong>
          <span>
            Automatic Section cues and manual overrides use the same loaded voice pack.
          </span>
        </div>

        <div className="guide-setting-group">
          <small>OUTPUT</small>
          <div>
            {([
              ["voice-and-click", "Voice + Click"],
              ["click-only", "Click Only"],
              ["voice-only", "Voice Only"],
              ["off", "Off"]
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                className={song.guideVoice.outputMode === mode ? "active" : ""}
                onClick={() =>
                  onSongChange({
                    ...song,
                    guideVoice: {
                      ...song.guideVoice,
                      outputMode: mode
                    }
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="guide-setting-group">
          <small>SECTION CUES</small>
          <div>
            <button
              className={song.guideVoice.sectionCues === "automatic" ? "active" : ""}
              onClick={() =>
                onSongChange({
                  ...song,
                  guideVoice: {
                    ...song.guideVoice,
                    sectionCues: "automatic"
                  }
                })
              }
            >
              Automatic
            </button>
            <button
              className={song.guideVoice.sectionCues === "off" ? "active" : ""}
              onClick={() =>
                onSongChange({
                  ...song,
                  guideVoice: {
                    ...song.guideVoice,
                    sectionCues: "off"
                  }
                })
              }
            >
              Off
            </button>
          </div>
        </div>

        <div className="guide-setting-group">
          <small>COUNT FEEL</small>
          <div>
            <button
              className={song.guideVoice.countFeel === "notated" ? "active" : ""}
              onClick={() =>
                onSongChange({
                  ...song,
                  guideVoice: {
                    ...song.guideVoice,
                    countFeel: "notated"
                  }
                })
              }
            >
              Notated
            </button>
            <button
              className={song.guideVoice.countFeel === "compound" ? "active" : ""}
              onClick={() =>
                onSongChange({
                  ...song,
                  guideVoice: {
                    ...song.guideVoice,
                    countFeel: "compound"
                  }
                })
              }
            >
              Compound
            </button>
          </div>
        </div>

        <div className="guide-pack-label">
          <small>VOICE PACK</small>
          <strong>{song.guideVoice.voicePackId}</strong>
          <span>Long pre-rolls voice only the final bar by default.</span>
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

          <div className="section-direction-editor">
            <small>GUIDE CUE · SECTION START</small>
            <div className="direction-cue-options">
              <button
                className={!selectedDirectionMarker ? "active" : ""}
                onClick={() => setSectionDirectionCue()}
              >
                None
              </button>
              {directionCues.map(([token, label]) => (
                <button
                  key={token}
                  className={
                    selectedDirectionMarker?.token === token ? "active" : ""
                  }
                  onClick={() => setSectionDirectionCue(token, label)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span>
              Spoken on beat 1 of {selectedSection.name}. Uses the currently loaded voice pack.
            </span>
          </div>

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
              <label className="count-custom">
                <span>Custom</span>
                <input
                  type="number"
                  min="1"
                  max="32"
                  value={
                    selectedSection.countInOverride?.mode === "beats"
                      ? selectedSection.countInOverride.value ?? 4
                      : 4
                  }
                  onChange={(event) =>
                    setSectionCountIn({
                      mode: "beats",
                      value: clampCountBeats(Number(event.currentTarget.value))
                    })
                  }
                />
              </label>
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
  const transitionActive = Boolean(audio.status.transitionActive);
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

      {transitionActive && (
        <div className="count-in-live panel">
          <div>
            <small>MANUAL TRANSITION</small>
            <strong>{queued ? "→ " + queued.name : "COUNT-IN"}</strong>
          </div>
          <div className="count-number">
            {countActive
              ? audio.status.countInBeat || "•"
              : "→"}
            <span>
              {countActive
                ? "/ " +
                  (audio.status.countInTotal ?? 0) +
                  ((audio.status.countInBars ?? 0) > 1
                    ? " · bar " +
                      (audio.status.countInBar ?? 0) +
                      "/" +
                      (audio.status.countInBars ?? 0)
                    : "")
                : " quantized"}
            </span>
          </div>
          <p>{countActive ? "Landing on beat 1" : "No count · beat-quantized jump"}</p>
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
            label={
              countActive
                ? "Count-In Active"
                : transitionActive
                  ? "Section Jump Queued"
                  : "Timeline Auto-Follow"
            }
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
          disabled={current <= 0 || transitionActive}
          onClick={() => onLaunchSection(Math.max(0, current - 1))}
        >
          <ChevronLeft /> Previous Section
        </button>
        <button
          className="go"
          disabled={transitionActive || current >= song.sections.length - 1}
          onClick={() => onLaunchSection(automaticNextIndex)}
        >
          GO
          <small>MANUAL OVERRIDE</small>
        </button>
        <button
          disabled={transitionActive || current >= song.sections.length - 1}
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

function clampCountBeats(value: number) {
  if (!Number.isFinite(value)) return 4;
  return Math.max(1, Math.min(32, Math.round(value)));
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

function Pads({ initialPads, initialPadCount, onChange }: { initialPads?: PadSlot[]; initialPadCount?: 12 | 16; onChange: (pads: PadSlot[], padCount: 12 | 16) => void }) {
  const [active, setActive] = useState(0);
  const [padCount, setPadCount] = useState<12 | 16>(initialPadCount ?? 12);
  const [playing, setPlaying] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [pads, setPads] = useState<PadSlot[]>(() => {
    const defaults = Array.from({ length: 16 }, (_, index) => padNames[index] ?? `Pad ${index + 1}`).map((name, index) => ({
      id: `pad-${index + 1}`,
      name,
      mode: "latch",
      gainDb: 0,
      octave: 0,
      width: 70,
      attackMs: 10,
      releaseMs: 1800
    }));
    return defaults.map((slot, index) => initialPads?.[index] ? { ...slot, ...initialPads[index] } : slot);
  });
  const pad = pads[active];

  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onChangeRef.current(pads, padCount); }, [pads, padCount]);

  useEffect(() => () => { for (let index = 0; index < 16; index += 1) void stopNativePad(index); }, []);

  function updatePad(update: Partial<PadSlot>) {
    setPads((current) => current.map((item, index) => index === active ? { ...item, ...update } : item));
  }

  async function replacePad() {
    try {
      setError("");
      const file = await choosePadAudio();
      if (file) {
        const next = { ...pad, path: file.path, name: file.name };
        updatePad({ path: file.path, name: file.name });
        await loadNativePad(active, next);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function pressPad(slot: PadSlot, index: number) {
    setActive(index);
    try {
      setError("");
      if (!slot.path) throw new Error("Load audio into this pad first.");
      if (slot.mode === "latch" && playing.has(slot.id)) {
        await releaseNativePad(index);
        setPlaying((current) => { const next = new Set(current); next.delete(slot.id); return next; });
        return;
      }
      await loadNativePad(index, slot);
      await triggerNativePad(index);
      setPlaying((current) => new Set(current).add(slot.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function liftPad(slot: PadSlot, index: number) {
    if (slot.mode !== "hold") return;
    void releaseNativePad(index);
    setPlaying((current) => { const next = new Set(current); next.delete(slot.id); return next; });
  }


  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Pad Player</h1>
          <p>{padCount} customizable background pads · WAV / MP3 / AIFF · native audio</p>
        </div>
        <div className="head-actions">
          <div className="segmented"><button className={padCount === 12 ? "active" : ""} onClick={() => setPadCount(12)}>12 Pads</button><button className={padCount === 16 ? "active" : ""} onClick={() => setPadCount(16)}>16 Pads</button></div>
          <button onClick={() => { for (let index = 0; index < 16; index += 1) void stopNativePad(index); setPlaying(new Set()); }}>Stop All</button>
        </div>
      </div>

      {error && <div className="audio-error panel">{error}</div>}

      <div className="pads-layout">
        <div className="pad-grid">
          {pads.slice(0, padCount).map((slot, index) => (
            <button
              key={slot.id}
              className={playing.has(slot.id) ? "pad active-pad" : "pad"}
              onPointerDown={() => pressPad(slot, index)}
              onPointerUp={() => liftPad(slot, index)}
              onPointerLeave={() => liftPad(slot, index)}
            >
              <span>{index + 1}</span>
              <Waveform seed={index} color={["#fbbf24", "#60a5fa", "#f472b6", "#2dd4bf"][index % 4]} />
              <strong>{slot.name}</strong>
              <small>{slot.path ? slot.mode : "Empty"}</small>
            </button>
          ))}
        </div>

        <div className="panel pad-inspector">
          <small>PAD {active + 1}</small>
          <h2>{pad.name}</h2>
          <Waveform seed={active} color="#fbbf24" />
          <label><span>Mode</span><select value={pad.mode} onChange={(e) => { const next = { ...pad, mode: e.currentTarget.value as PadSlot["mode"] }; updatePad({ mode: next.mode }); if (next.path) void loadNativePad(active, next); }}>
            <option value="one-shot">One Shot</option><option value="loop">Loop</option><option value="hold">Hold</option><option value="latch">Latch</option>
          </select></label>
          <label><span>Octave</span><input type="range" min="-2" max="2" step="1" value={pad.octave} onChange={(e) => { const next = { ...pad, octave: Number(e.currentTarget.value) }; updatePad({ octave: next.octave }); if (next.path) void loadNativePad(active, next); }} /><strong>{pad.octave > 0 ? "+" : ""}{pad.octave}</strong></label>
          <label><span>Wideness</span><input type="range" min="0" max="100" value={pad.width} onChange={(e) => { const next = { ...pad, width: Number(e.currentTarget.value) }; updatePad({ width: next.width }); void configureNativePad(active, next); }} /><strong>{pad.width}%</strong></label>
          <label><span>Volume</span><input type="range" min="-60" max="6" step=".5" value={pad.gainDb} onChange={(e) => { const next = { ...pad, gainDb: Number(e.currentTarget.value) }; updatePad({ gainDb: next.gainDb }); void configureNativePad(active, next); }} /><strong>{pad.gainDb.toFixed(1)} dB</strong></label>
          <label><span>Attack</span><input type="range" min="0" max="2000" step="10" value={pad.attackMs} onChange={(e) => { const next = { ...pad, attackMs: Number(e.currentTarget.value) }; updatePad({ attackMs: next.attackMs }); void configureNativePad(active, next); }} /><strong>{(pad.attackMs / 1000).toFixed(2)} s</strong></label>
          <label><span>Release</span><input type="range" min="0" max="5000" step="50" value={pad.releaseMs} onChange={(e) => { const next = { ...pad, releaseMs: Number(e.currentTarget.value) }; updatePad({ releaseMs: next.releaseMs }); void configureNativePad(active, next); }} /><strong>{(pad.releaseMs / 1000).toFixed(2)} s</strong></label>
          <button className="primary" onClick={() => void replacePad()}>{pad.path ? "Replace Audio" : "Load WAV / MP3 / AIFF"}</button>
          {pad.path && <code>{pad.path}</code>}
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
  const buses = [
    ["music", "Music", audio.status.musicBus],
    ["click", "Click", audio.status.clickBus],
    ["guide", "Guide", audio.status.guideBus],
    ["master", "Master", audio.status.masterBus]
  ] as const;
  const outputChannels = Math.max(1, audio.status.outputChannels ?? 2);
  const outputOptions = Array.from(
    { length: outputChannels },
    (_, index) => index + 1
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

      <div className="bus-mixer panel">
        <div className="bus-mixer-title">
          <div>
            <small>OUTPUT BUSES</small>
            <strong>Music · Click · Guide · Master</strong>
          </div>
          <span>
            Click and Guide are independent buses and can be assigned to separate hardware outputs.
          </span>
        </div>

        {buses.map(([id, label, bus]) => (
          <div className="bus-channel" key={id}>
            <strong>{label}</strong>
            <span>{(bus?.gainDb ?? 0).toFixed(1)} dB</span>
            <input
              type="range"
              min="-60"
              max="12"
              step="0.5"
              value={bus?.gainDb ?? 0}
              disabled={!audio.status.initialized}
              onChange={(event) =>
                void audio.setBusGain(id, Number(event.currentTarget.value))
              }
            />
            {id !== "master" && (
              <div className="bus-route">
                <label>
                  <span>L</span>
                  <select
                    value={bus?.outputLeft ?? 1}
                    disabled={!audio.status.initialized}
                    onChange={(event) =>
                      void audio.setBusRoute(
                        id,
                        Number(event.currentTarget.value),
                        bus?.outputRight ?? Math.min(2, outputChannels)
                      )
                    }
                  >
                    {outputOptions.map((channel) => (
                      <option key={channel} value={channel}>
                        Out {channel}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>R</span>
                  <select
                    value={bus?.outputRight ?? Math.min(2, outputChannels)}
                    disabled={!audio.status.initialized}
                    onChange={(event) =>
                      void audio.setBusRoute(
                        id,
                        bus?.outputLeft ?? 1,
                        Number(event.currentTarget.value)
                      )
                    }
                  >
                    {outputOptions.map((channel) => (
                      <option key={channel} value={channel}>
                        Out {channel}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <button
              className={bus?.muted ? "channel-toggle active danger" : "channel-toggle"}
              disabled={!audio.status.initialized}
              onClick={() => void audio.setBusMuted(id, !bus?.muted)}
            >
              {bus?.muted ? "MUTED" : "MUTE"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Lighting({
  song,
  lumarig
}: {
  song: Song;
  lumarig: ReturnType<typeof useLumaRig>;
}) {
  const connected = lumarig.state === "connected";

  async function connectLocal() {
    await lumarig.connect(loopbackLumaRigPeer());
    await lumarig.resolveSong({
      studioShowId: "current-studio-show",
      studioShowName: "Current Studio Show",
      songId: song.id,
      songTitle: song.title,
      bpm: song.bpm
    }, true);
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Lighting</h1>
          <p>LumaRig programming and song recall · {song.title}</p>
        </div>
        <span className={connected ? "ready" : "muted"}>
          <span className={connected ? "dot ok" : "dot bad"} />
          {connected ? "LumaRig Connected" : "LumaRig Offline"}
        </span>
      </div>

      <div className="panel remote-pairing-card">
        <div>
          <small>LUMARIG BRIDGE</small>
          <h2>{connected ? lumarig.peer?.name ?? "LumaRig" : "Connect Lighting Engine"}</h2>
          <p>{connected
            ? "This song is linked to its LumaRig show. Cues, FX and recorded lighting stay in LumaRig while Studio owns song transport."
            : "Studio first checks for LumaRig on this computer. LAN discovery and Network Session are the next fallback transports."}</p>
        </div>
        <div className="remote-session-buttons">
          {!connected
            ? <button className="primary" onClick={() => void connectLocal()}>Detect LumaRig</button>
            : <>
                <button onClick={() => void lumarig.resolveSong({
                  studioShowId: "current-studio-show", studioShowName: "Current Studio Show",
                  songId: song.id, songTitle: song.title, bpm: song.bpm
                }, true)}>Recall Song Show</button>
                <button onClick={() => void lumarig.disconnect()}>Disconnect</button>
              </>}
        </div>
      </div>

      {lumarig.error && <div className="audio-error panel">{lumarig.error}</div>}

      <div className="lighting-layout">
        <div className="panel fixtures">
          <h3>LumaRig Control</h3>
          <button disabled={!connected} onClick={() => void lumarig.send({ type: "cue.go" })}>GO Cue</button>
          <button disabled={!connected} onClick={() => void lumarig.send({ type: "record.start", songId: song.id, songTitle: song.title, bpm: song.bpm })}>Record Show</button>
          <button disabled={!connected} onClick={() => void lumarig.send({ type: "record.stop" })}>Stop Recording</button>
          <button className="danger-outline" disabled={!connected} onClick={() => void lumarig.send({ type: "blackout", enabled: true })}>Blackout</button>
          <small>Fixture programming remains in LumaRig.</small>
        </div>

        <div className="panel lighting-timeline">
          <div className="section-ruler">
            {song.sections.map((section) => (
              <div key={section.id} className="section-block" style={{ flex: section.lengthBars, background: section.color }}>
                {section.name}
              </div>
            ))}
          </div>
          {["Intensity", "Color", "Movement", "Beam", "Strobe", "FX"].map((lane, index) => (
            <div className="light-lane" key={lane}>
              <strong>{lane}</strong>
              <div><Waveform seed={index} color={["#60a5fa", "#f472b6", "#22d3ee", "#a78bfa", "#cbd5e1", "#8b5cf6"][index]} /></div>
            </div>
          ))}
        </div>

        <div className="panel cue-inspector">
          <small>SONG LINK</small>
          <h2>{song.title}</h2>
          <Field label="BPM" value={String(song.bpm)} />
          <Field label="Connection" value={connected ? lumarig.peer?.transport ?? "local" : "offline"} />
          <Field label="Authority" value="LumaRig" />
          <Field label="Sync" value="Studio Transport" />
        </div>
      </div>
    </section>
  );
}

function Connections({
  audio,
  remote,
  lumarig,
  song,
  onSongChange
}: {
  audio: AudioEngineController;
  remote: ReturnType<typeof useRemoteRelay>;
  lumarig: ReturnType<typeof useLumaRig>;
  song: Song;
  onSongChange: (song: Song) => void;
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
    ["Lighting", lumarig.peer?.name ?? "LumaRig", lumarig.state === "connected" ? "Direct bridge connected" : "Not connected"],
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

      <div className="panel guide-pack-card">
        <div>
          <small>GUIDE VOICE</small>
          <h2>{audio.status.voicePack?.name ?? "No Voice Pack Loaded"}</h2>
          <p>
            {audio.status.voicePack
              ? audio.status.voicePack.voice +
                " · " +
                audio.status.voicePack.locale +
                " · " +
                audio.status.voicePack.assetCount +
                " reusable tokens"
              : "Load a 44-token LumaRig voice pack. The same pack works across every Song and Setlist."}
          </p>
        </div>

        <div className="guide-pack-status">
          <span className={audio.status.voicePack ? "ready" : "muted"}>
            {audio.status.voicePack ? "Ready" : "Not Loaded"}
          </span>
          <span>
            Song Pack: {song.guideVoice.voicePackId}
          </span>
        </div>

        <button
          className="primary"
          disabled={audio.busy}
          onClick={() => {
            void (async () => {
              const pack = await audio.chooseAndLoadVoicePack();
              if (!pack) return;
              onSongChange({
                ...song,
                guideVoice: {
                  ...song.guideVoice,
                  voicePackId: pack.id
                }
              });
            })();
          }}
        >
          {audio.status.voicePack ? "Load Different Pack" : "Load Voice Pack"}
        </button>
      </div>

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
                      : title === "MIDI"
                        ? "muted"
                        : title === "Lighting" && lumarig.state !== "connected"
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
