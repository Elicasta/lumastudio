import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
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
import { SessionView } from "../components/SessionView";
import { createProject } from "../domain/project";
import { createServiceSong, moveServiceItem, reflowSongSections, selectedServiceSong } from "../domain/service";
import { missingMedia, projectMediaPaths, type MediaFileStatus } from "../domain/preflight";
import { isNativeApp } from "../services/audio";
import { openProject, saveProject } from "../services/projectStore";
import { clearRecovery, readRecovery, writeRecovery } from "../services/recovery";
import { chooseLocalVideo, createYouTubeClip } from "../services/video";
import type { VideoClip, VideoProgram, VideoProgramState } from "../domain/video";
import { VideoProgram as VideoProgramRenderer } from "../components/VideoProgram";
import { fullscreenVideoOutput, openVideoOutput } from "../services/videoOutput";
import { listenVideoOutputRequests, publishVideoOutputState } from "../services/videoOutputState";
import { LumaVizMediaBus } from "../services/lumavizMedia";
import type { BuildTool, CountInSettings, Page, Setlist, ShowTool, Song, Workspace } from "../domain/types";
import { adjacentSong } from "../domain/setlist";
import { sectionCueDispatch } from "../domain/cues";
import { dispatchSectionCue } from "../services/cueDispatcher";
import { connectMidiOutput, disconnectMidiOutput, listMidiOutputs, sendControlChange, sendMidiPatch, sendProgramChange, type MidiPort } from "../services/midi";
import type { MidiSettings } from "../domain/midi";
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
import { IntegrationsPage } from "../components/IntegrationsPage";
import { PresentationEditor } from "../components/PresentationEditor";
import { defaultIntegrationSettings } from "../domain/integrations";
import { cueIdsBeforePosition, duePresentationCues } from "../domain/presentation";
import { useProPresenter } from "../hooks/useProPresenter";
import type { PlanningCenterPlanImport } from "../services/planningCenter";
import { normalizeProPresenterName } from "../services/propresenter";

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
  { tool: "presentation", label: "Presentation", icon: Radio },
  { tool: "midi", label: "MIDI", icon: Radio },
  { tool: "video", label: "Video", icon: Clapperboard }
];

const showNav: Array<{ tool: ShowTool; label: string; icon: typeof Music2 }> = [
  { tool: "setlist", label: "Setlist", icon: ListMusic },
  { tool: "connections", label: "Connections", icon: Cable },
  { tool: "integrations", label: "Integrations", icon: Radio },
  { tool: "settings", label: "Settings", icon: Settings }
];

function fmt(seconds: number) {
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

export function App() {
  const [page, setPage] = useState<Page>("show");
  const [buildTool, setBuildTool] = useState<BuildTool>("arrangement");
  const [showTool, setShowTool] = useState<ShowTool>("setlist");
  const [project, setProject] = useState(() => createProject("New Service"));
  const [projectPath, setProjectPath] = useState<string | undefined>();
  const [selectedSong, setSelectedSong] = useState<Song>(() => createServiceSong("Untitled item"));
  const [projectError, setProjectError] = useState("");
  const [pendingRecovery, setPendingRecovery] = useState(() => readRecovery(window.localStorage));
  const [recoveryError, setRecoveryError] = useState("");
  const recoverySnapshotRef = useRef(project);
  const [mediaCheck, setMediaCheck] = useState<{ missing: string[]; checked: number; error?: string } | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const lumaVizMediaRef = useRef<LumaVizMediaBus>();
  const [importOpen, setImportOpen] = useState(false);
  const [currentSection, setCurrentSection] = useState(0);
  const [liveLayout, setLiveLayout] = useState<"session"|"performance">("session");
  const [queuedManualSection, setQueuedManualSection] = useState<number | null>(null);
  const selectingSongRef = useRef(false);
  const audio = useAudioEngine();
  const lumarig = useLumaRig();
  const [remoteLightingBlackout, setRemoteLightingBlackout] = useState(false);
  const [playingPadIds, setPlayingPadIds] = useState<Set<string>>(() => new Set());
  const padSlots = useMemo(() => makePadSlots(project.pads), [project.pads]);
  const visiblePadSlots = padSlots.slice(0, project.padCount ?? 12);
  const stopAllPadVoices = useCallback(async () => {
    await Promise.allSettled(Array.from({ length: 16 }, (_, index) => stopNativePad(index)));
    setPlayingPadIds(new Set());
  }, []);
  useEffect(() => () => {
    for (let index = 0; index < 16; index += 1) void stopNativePad(index);
  }, []);
  recoverySnapshotRef.current = { ...project, setlist: { ...project.setlist, songs: project.setlist.songs.map(song => song.id === selectedSong.id ? selectedSong : song) } };
  useEffect(() => {
    if (pendingRecovery) return;
    const timer = window.setTimeout(() => {
      try {
        writeRecovery(window.localStorage, recoverySnapshotRef.current);
        setRecoveryError("");
      } catch (error) { setRecoveryError(`Local recovery could not be saved: ${String(error)}`); }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [project, selectedSong, pendingRecovery]);
  useEffect(() => {
    if (pendingRecovery) return;
    const persist = () => { try { writeRecovery(window.localStorage, recoverySnapshotRef.current); } catch { /* Shown by the ordinary save timer. */ } };
    window.addEventListener("pagehide", persist);
    return () => window.removeEventListener("pagehide", persist);
  }, [pendingRecovery]);
  const mediaPaths = useMemo(() => projectMediaPaths(project), [project]);
  const checkMedia = useCallback(async () => {
    if (!isNativeApp()) { setMediaCheck({missing: [], checked: 0, error: "File preflight is available in the desktop app."}); return; }
    try {
      const files = await invoke<MediaFileStatus[]>("project_media_status", { paths: mediaPaths });
      setMediaCheck({ missing: missingMedia(mediaPaths, files), checked: mediaPaths.length });
    } catch (error) { setMediaCheck({missing: [], checked: 0, error: `File preflight failed: ${String(error)}`}); }
  }, [mediaPaths]);
  useEffect(() => { if (page === "show" || page === "live") void checkMedia(); }, [page, checkMedia]);
  const integrationSettings = project.integrations ?? defaultIntegrationSettings();
  const proPresenter = useProPresenter(integrationSettings.propresenter, selectedSong, currentSection);
  const lastDispatchedSectionRef = useRef<string | null>(null);
  const presentationRuntimeRef = useRef({
    songId: "",
    lastPosition: -0.001,
    fired: new Set<string>()
  });
  const presentationQueueRef = useRef<Array<"next" | "previous">>([]);
  const presentationQueueDrainingRef = useRef(false);

  const drainPresentationQueue = useCallback(async () => {
    if (presentationQueueDrainingRef.current) return;
    presentationQueueDrainingRef.current = true;
    try {
      while (presentationQueueRef.current.length > 0) {
        const action = presentationQueueRef.current.shift();
        try {
          if (action === "next") await proPresenter.next();
          if (action === "previous") await proPresenter.previous();
        } catch {
          presentationQueueRef.current = [];
          break;
        }
      }
    } finally {
      presentationQueueDrainingRef.current = false;
    }
  }, [proPresenter.next, proPresenter.previous]);

  useEffect(() => {
    const position = Math.max(0, audio.status.positionSeconds ?? 0);
    const runtime = presentationRuntimeRef.current;
    const automation = selectedSong.presentation;
    const presenterName = proPresenter.state.presentationName;
    const presentationMatches = Boolean(
      presenterName
      && normalizeProPresenterName(presenterName) === normalizeProPresenterName(selectedSong.title)
    );

    if (runtime.songId !== selectedSong.id) {
      runtime.songId = selectedSong.id;
      runtime.lastPosition = Math.max(-0.001, position - 0.05);
      runtime.fired = cueIdsBeforePosition(selectedSong, Math.max(0, position - 0.05));
      presentationQueueRef.current = [];
    }

    const canAuto =
      automation?.mode === "full-auto"
      && integrationSettings.propresenter.enabled
      && proPresenter.state.connected
      && presentationMatches
      && Boolean(audio.status.playing)
      && !audio.status.transitionActive;

    if (!canAuto) {
      runtime.lastPosition = position;
      if (!proPresenter.state.connected || !presentationMatches || automation?.mode !== "full-auto") {
        runtime.fired = cueIdsBeforePosition(selectedSong, position);
        presentationQueueRef.current = [];
      }
      return;
    }

    const delta = position - runtime.lastPosition;
    if (delta < -0.1 || delta > 1.5) {
      runtime.fired = cueIdsBeforePosition(selectedSong, position);
      runtime.lastPosition = position;
      presentationQueueRef.current = [];
      return;
    }

    const due = duePresentationCues(
      selectedSong,
      runtime.lastPosition,
      position,
      runtime.fired
    );
    runtime.lastPosition = position;

    if (due.length === 0) return;
    for (const cue of due) {
      runtime.fired.add(cue.id);
      presentationQueueRef.current.push(cue.action);
    }
    void drainPresentationQueue();
  }, [
    audio.status.playing,
    audio.status.positionSeconds,
    audio.status.transitionActive,
    drainPresentationQueue,
    integrationSettings.propresenter.enabled,
    proPresenter.state.connected,
    proPresenter.state.presentationName,
    selectedSong
  ]);

  useEffect(() => {
    const bus = lumaVizMediaRef.current ?? new LumaVizMediaBus();
    lumaVizMediaRef.current = bus;
    bus.publish({
      outputId:"program-1",
      program:project.video,
      positionSeconds:audio.status.positionSeconds ?? 0,
      playing:Boolean(audio.status.playing || previewPlaying),
      sectionId:selectedSong.sections[currentSection]?.id
    });
  }, [project.video, audio.status.positionSeconds, audio.status.playing, previewPlaying, selectedSong.sections, currentSection]);

  useEffect(() => {
    void publishVideoOutputState({
      program: project.video,
      positionSeconds: audio.status.positionSeconds ?? 0,
      playing: Boolean(audio.status.playing || previewPlaying),
      sectionId: selectedSong.sections[currentSection]?.id
    }).catch(() => undefined);
  }, [project.video, audio.status.positionSeconds, audio.status.playing, previewPlaying, selectedSong.sections, currentSection]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    void listenVideoOutputRequests(() => {
      void publishVideoOutputState({
        program: project.video,
        positionSeconds: audio.status.positionSeconds ?? 0,
        playing: Boolean(audio.status.playing || previewPlaying),
        sectionId: selectedSong.sections[currentSection]?.id
      });
    }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; });
    return () => { disposed = true; stop?.(); };
  }, [project.video, audio.status.positionSeconds, audio.status.playing, previewPlaying, selectedSong.sections, currentSection]);

  function nativeTracksForSong(song: Song): NativeAudioTrack[] {
    return song.tracks.flatMap((track) => track.media ? [{
      id: track.media.id,
      name: track.name,
      path: track.media.path,
      gainDb: track.gainDb,
      startSeconds: track.media.startSeconds,
      kind: track.kind,
      color: track.color
    }] : []);
  }

  const selectSetlistSong = useCallback(
    async (song: Song) => {
      if (selectingSongRef.current || audio.status.playing || audio.status.transitionActive || audio.status.countInActive) return false;
      selectingSongRef.current = true;
      try {
      if (audio.hasLoadedAudio) {
        await audio.stop();
      }
      const songMedia = nativeTracksForSong(song);
      if ((songMedia.length || audio.hasLoadedAudio) && !await audio.loadTracks(songMedia)) return false;
      setPreviewPlaying(false);
      setQueuedManualSection(null);
      setSelectedSong(song);
      setProject((current) => ({ ...current, selectedSongId: song.id, updatedAt: new Date().toISOString() }));
      setCurrentSection(0);
      return true;
      } finally { selectingSongRef.current = false; }
    },
    [audio.hasLoadedAudio, audio.stop, audio.loadTracks, audio.status.playing, audio.status.transitionActive, audio.status.countInActive]
  );

  const startPlayback = useCallback(async () => {
    if (!audio.hasLoadedAudio) {
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
          if (!audio.hasLoadedAudio) return reject("No audio is loaded for the selected item.");
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
          return await selectSetlistSong(song) ? ok() : reject("The next item's audio could not be loaded. The current item is unchanged.");
        }

        case "song.select": {
          const id = String(message.payload?.id ?? "");
          const song = project.setlist.songs.find((item) => item.id === id);
          if (!song) return reject("Song not found in the active Setlist.");
          return await selectSetlistSong(song) ? ok() : reject("The selected item's audio could not be loaded. The current item is unchanged.");
        }

        case "mixer.gain": {
          const id = String(message.payload?.id ?? "");
          const gainDb = Number(message.payload?.gainDb);
          if (!Number.isFinite(gainDb)) return reject("Invalid gain value.");

          const track = selectedSong.tracks.find((item) => item.id === id);
          if (!track) return reject("Track not found in the selected item.");
          const nativeId = track.media?.id;
          if (nativeId && audio.tracks.some((item) => item.id === nativeId)) {
            await audio.setTrackGain(nativeId, gainDb);
          }

          setSelectedSong((song) => ({
            ...song,
            tracks: song.tracks.map((item) =>
              item.id === id ? { ...item, gainDb } : item
            )
          }));
          return ok();
        }

        case "mixer.mute": {
          const id = String(message.payload?.id ?? "");
          const muted = Boolean(message.payload?.muted);

          const track = selectedSong.tracks.find((item) => item.id === id);
          if (!track) return reject("Track not found in the selected item.");
          const nativeId = track.media?.id;
          if (nativeId && audio.tracks.some((item) => item.id === nativeId)) {
            await audio.setTrackMuted(nativeId, muted);
          }

          setSelectedSong((song) => ({
            ...song,
            tracks: song.tracks.map((item) =>
              item.id === id ? { ...item, muted } : item
            )
          }));
          return ok();
        }

        case "mixer.solo": {
          const id = String(message.payload?.id ?? "");
          const solo = Boolean(message.payload?.solo);

          const track = selectedSong.tracks.find((item) => item.id === id);
          if (!track) return reject("Track not found in the selected item.");
          const nativeId = track.media?.id;
          if (nativeId && audio.tracks.some((item) => item.id === nativeId)) {
            await audio.setTrackSolo(nativeId, solo);
          }

          setSelectedSong((song) => ({
            ...song,
            tracks: song.tracks.map((item) =>
              item.id === id ? { ...item, solo } : item
            )
          }));
          return ok();
        }

        case "pad.trigger": {
          const id = String(message.payload?.id ?? "").trim();
          const index = visiblePadSlots.findIndex((slot) => slot.id === id);
          if (index < 0) return reject("Pad not found in the active pad bank.");
          const slot = visiblePadSlots[index];
          if (!slot.path) return reject("Load audio into this pad before triggering it.");

          if (slot.mode === "latch" && playingPadIds.has(slot.id)) {
            await releaseNativePad(index);
            setPlayingPadIds((current) => {
              const next = new Set(current);
              next.delete(slot.id);
              return next;
            });
            return ok();
          }

          await loadNativePad(index, slot);
          await triggerNativePad(index);
          if (slot.mode !== "one-shot") {
            setPlayingPadIds((current) => new Set(current).add(slot.id));
          }
          return ok();
        }

        case "pad.release": {
          const id = String(message.payload?.id ?? "").trim();
          const index = visiblePadSlots.findIndex((slot) => slot.id === id);
          if (index < 0) return reject("Pad not found in the active pad bank.");
          const slot = visiblePadSlots[index];
          if (slot.mode !== "hold") return ok();
          await releaseNativePad(index);
          setPlayingPadIds((current) => {
            const next = new Set(current);
            next.delete(slot.id);
            return next;
          });
          return ok();
        }

        case "lighting.blackout": {
          if (lumarig.state !== "connected") return reject("LumaRig is not connected.");
          const enabled = message.payload?.enabled;
          if (typeof enabled !== "boolean") return reject("Blackout command requires an enabled boolean.");
          const result = await lumarig.send({ type: "blackout", enabled });
          if (!result.ok) return reject(result.error ?? "LumaRig blackout command failed.");
          setRemoteLightingBlackout(enabled);
          return ok();
        }

        case "lighting.scene": {
          if (lumarig.state !== "connected") return reject("LumaRig is not connected.");
          const sceneId = String(message.payload?.sceneId ?? message.payload?.id ?? "").trim();
          if (!sceneId) return reject("Lighting scene command requires a scene id.");
          const result = await lumarig.send({ type: "scene.fire", sceneId });
          if (!result.ok) return reject(result.error ?? "LumaRig scene command failed.");
          return ok();
        }

        case "lighting.xy":
          return reject("Lighting XY control is not supported by the current LumaRig bridge.");
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
      project.setlist,
      lumarig.state,
      lumarig.send,
      visiblePadSlots,
      playingPadIds
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
        queuedSectionIndex: queuedManualSection,
        lightingConnected: lumarig.state === "connected",
        lightingBlackout: remoteLightingBlackout,
        pads: visiblePadSlots,
        activePadIds: playingPadIds
      }),
    [audio.status, currentSection, previewPlaying, queuedManualSection, selectedSong, project.setlist, lumarig.state, remoteLightingBlackout, visiblePadSlots, playingPadIds]
  );

  const remote = useRemoteRelay(remoteState, handleRemoteCommand);

  useEffect(() => {
    const section = selectedSong.sections[currentSection];
    if (!section) return;
    const key = selectedSong.id + ":" + section.id;
    if (lastDispatchedSectionRef.current === key) return;
    lastDispatchedSectionRef.current = key;
    const cue = sectionCueDispatch(selectedSong, section);
    void dispatchSectionCue(cue, {
      video: project.video,
      sendMidiPatch,
      midiConnected: Boolean(project.midi?.outputName),
      sendLumaRig: lumarig.state === "connected" ? (command) => lumarig.send(command) : undefined
    });
  }, [selectedSong, currentSection, project.video, lumarig.state, lumarig.send]);

  useEffect(() => {
    setProject((current) => ({
      ...current,
      selectedSongId: current.setlist.songs.some(song => song.id === selectedSong.id) ? selectedSong.id : current.selectedSongId,
      updatedAt: current.setlist.songs.some(song => song.id === selectedSong.id) ? new Date().toISOString() : current.updatedAt,
      setlist: {
        ...current.setlist,
        songs: current.setlist.songs.map((song) => song.id === selectedSong.id ? selectedSong : song)
      }
    }));
  }, [selectedSong]);

  async function saveCurrentProject(saveAs = false) {
    try {
      const snapshot = { ...project, setlist: { ...project.setlist, songs: project.setlist.songs.map(song => song.id === selectedSong.id ? selectedSong : song) } };
      const path = await saveProject(snapshot, saveAs ? undefined : projectPath);
      if (path) { setProjectPath(path); setProjectError(""); }
    } catch (error) { setProjectError(String(error)); }
  }

  async function openStudioProject() {
    if (audio.status.playing || audio.status.transitionActive || audio.status.countInActive) { setProjectError("Stop playback before opening a different service."); return; }
    try {
      const opened = await openProject();
      if (!opened) return;
      await stopAllPadVoices();
      const song = selectedServiceSong(opened.project.setlist.songs, opened.project.selectedSongId);
      if (song || audio.hasLoadedAudio) {
        const loaded = await audio.loadTracks(song ? nativeTracksForSong(song) : []);
        if (!loaded) { setProjectError("Project was not opened: its audio could not be loaded. The current service is unchanged."); return; }
      }
      setProject(opened.project);
      setProjectPath(opened.path);
      setSelectedSong(song ?? createServiceSong("Untitled item"));
      setCurrentSection(0);
      setQueuedManualSection(null);
      setPreviewPlaying(false);
      setProjectError("");
      setPendingRecovery(null);
    } catch (error) { setProjectError(String(error)); }
  }

  async function newService() {
    if (audio.status.playing || audio.status.transitionActive || audio.status.countInActive) { setProjectError("Stop playback before starting a new service."); return; }
    if ((project.setlist.songs.length || projectPath) && !window.confirm("Create a new service? Save your current service first if you need to keep recent changes.")) return;
    if (audio.hasLoadedAudio && !await audio.loadTracks([])) { setProjectError("Cannot clear the current audio. The service was not changed."); return; }
    await stopAllPadVoices();
    const blank = createProject("New Service");
    setProject(blank);
    setProjectPath(undefined);
    setSelectedSong(createServiceSong("Untitled item"));
    setQueuedManualSection(null);
    setCurrentSection(0);
    setPreviewPlaying(false);
    setProjectError("");
    setPendingRecovery(null);
    setShowTool("setlist"); setPage("show");
  }

  async function addServiceSong(title: string) {
    if (audio.status.playing || audio.status.transitionActive || audio.status.countInActive) { setProjectError("Stop playback before changing the running order."); return false; }
    if (audio.hasLoadedAudio && !await audio.loadTracks([])) { setProjectError("Cannot clear the previous item's audio. Item was not added."); return false; }
    const song = createServiceSong(title);
    setProject(current => ({ ...current, selectedSongId: song.id, setlist: { ...current.setlist, songs: [...current.setlist.songs, song] }, updatedAt: new Date().toISOString() }));
    setSelectedSong(song); setCurrentSection(0); setQueuedManualSection(null);
    setProjectError("");
    return true;
  }

  async function restoreService() {
    if (!pendingRecovery || audio.status.playing || audio.status.transitionActive) return;
    await stopAllPadVoices();
    const recovered = pendingRecovery.project;
    const song = selectedServiceSong(recovered.setlist.songs, recovered.selectedSongId);
    if (song && nativeTracksForSong(song).length && !await audio.loadTracks(nativeTracksForSong(song))) {
      setProjectError("Service recovered, but its audio could not be loaded. Check the assigned files and output device.");
    }
    setProject(recovered); setProjectPath(undefined);
    setSelectedSong(song ?? createServiceSong("Untitled item"));
    setQueuedManualSection(null); setCurrentSection(0); setPreviewPlaying(false);
    setPendingRecovery(null);
    setShowTool("setlist"); setPage("show");
  }

  function discardRecovery() {
    try { clearRecovery(window.localStorage); } catch { /* A blocked store cannot be cleared. */ }
    setPendingRecovery(null);
  }

  function renameService(name: string) {
    if (audio.status.playing || audio.status.transitionActive || audio.status.countInActive) return false;
    const next = name.trim();
    if (!next) return false;
    setProject(current => ({ ...current, name: next, setlist: { ...current.setlist, name: next }, updatedAt: new Date().toISOString() }));
    return true;
  }

  function moveItem(id: string, direction: -1 | 1) {
    if (audio.status.playing || audio.status.transitionActive || audio.status.countInActive) return;
    setProject(current => ({ ...current, setlist: { ...current.setlist, songs: moveServiceItem(current.setlist.songs, id, direction) }, updatedAt: new Date().toISOString() }));
  }

  async function removeItem(id: string) {
    if (selectingSongRef.current || audio.status.playing || audio.status.transitionActive || audio.status.countInActive) return false;
    const item = project.setlist.songs.find(song => song.id === id);
    if (!item || !window.confirm(`Remove ${item.title} from this service? This also removes its arrangement and cues.`)) return false;
    selectingSongRef.current = true;
    try {
      const remaining = project.setlist.songs.filter(song => song.id !== id);
      const next = selectedSong.id === id ? (remaining[Math.min(project.setlist.songs.indexOf(item), remaining.length - 1)] ?? remaining[remaining.length - 1]) : selectedSong;
      if (selectedSong.id === id && (audio.hasLoadedAudio || (next && nativeTracksForSong(next).length))) {
        if (!await audio.loadTracks(next ? nativeTracksForSong(next) : [])) { setProjectError("Could not load the next item's audio. The current item was kept."); return false; }
      }
      setProject(current => ({ ...current, setlist: { ...current.setlist, songs: remaining }, selectedSongId: next?.id, updatedAt: new Date().toISOString() }));
      if (selectedSong.id === id) { setSelectedSong(next ?? createServiceSong("Untitled item")); setCurrentSection(0); setQueuedManualSection(null); }
      setProjectError("");
      return true;
    } finally { selectingSongRef.current = false; }
  }

  function applyPlanningCenterImport(value: PlanningCenterPlanImport) {
    if (audio.status.playing || audio.status.transitionActive || audio.status.countInActive) { setProjectError("Stop playback before importing a new running order."); return; }
    const firstSong = value.songs[0];
    setProject((current) => ({
      ...current,
      name: value.link.planDates || value.link.planTitle || current.name,
      setlist: {
        ...current.setlist,
        name: value.link.planDates || value.link.planTitle || current.setlist.name,
        songs: value.songs
      },
      selectedSongId: firstSong?.id,
      integrations: {
        ...(current.integrations ?? defaultIntegrationSettings()),
        planningCenter: value.link
      },
      updatedAt: new Date().toISOString()
    }));
    if (firstSong) {
      setSelectedSong(firstSong);
      setCurrentSection(0);
      setQueuedManualSection(null);
    }
  }

  const applyNativeTracks = useCallback((
    tracks: NativeAudioTrack[],
    status: NativeAudioStatus
  ) => {
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
          gainDb: track.gainDb,
          media: { id: track.id, path: track.path, startSeconds: track.startSeconds }
        })),
        ...song.tracks.filter((track) =>
          ["midi", "lighting", "video"].includes(track.kind)
        )
      ]
    }));
  }, []);

  return (
    <div className="app-shell">
      <Sidebar page={page} onPage={setPage} />
      <main className="main">
        {project.setlist.songs.length > 0 && <Transport
          song={selectedSong}
          projectName={project.name}
          rigConnected={lumarig.state === "connected"}
          previewPlaying={previewPlaying}
          onPreviewPlaying={setPreviewPlaying}
          audio={audio}
          remoteOnline={remote.status === "online"}
          onStart={startPlayback}
          onPause={pausePlayback}
          onStop={stopPlayback}
        />}
        <div className="workspace">
          {pendingRecovery && <aside className="service-recovery panel" role="status"><div><strong>Previous Studio service found</strong><p>{pendingRecovery.project.name} · {pendingRecovery.project.setlist.songs.length} items · last saved locally {new Date(pendingRecovery.savedAt).toLocaleString()}</p><small>Restore the show layout and file assignments. Audio output must be checked again.</small></div><div><button className="primary" onClick={() => void restoreService()}>Restore service</button><button onClick={discardRecovery}>Start fresh</button></div></aside>}
          {!pendingRecovery && <>
          {recoveryError && <p role="alert" className="service-error">{recoveryError}</p>}
          {page === "live" && mediaCheck?.error && <aside className="live-preflight-warning panel" role="alert"><strong>LIVE FILE CHECK UNAVAILABLE</strong><span>{mediaCheck.error}</span><button onClick={() => void checkMedia()}>Run file check</button></aside>}
          {page === "live" && !mediaCheck?.error && mediaCheck && mediaCheck.missing.length > 0 && <aside className="live-preflight-warning panel" role="alert"><strong>{mediaCheck.missing.length} MEDIA FILE{mediaCheck.missing.length === 1 ? "" : "S"} NEED ATTENTION</strong><span>{mediaCheck.missing.slice(0, 3).map(path => path.split(/[\\/]/).pop() || path).join(" · ")}{mediaCheck.missing.length > 3 ? ` · +${mediaCheck.missing.length - 3} more` : ""}</span><button onClick={() => { setShowTool("setlist"); setPage("show"); }}>Review readiness</button></aside>}
          {project.setlist.songs.length === 0 && page !== "show" && <section className="service-empty-workspace panel"><small>NEW SERVICE</small><h1>Build the running order first</h1><p>Add a song or service item in Show. Then import its audio and prepare the arrangement.</p><button className="primary" onClick={() => { setShowTool("setlist"); setPage("show"); }}>Open running order</button></section>}
          {project.setlist.songs.length > 0 && page === "import" && (
            <Sources audio={audio} onLoaded={(tracks, status) => {
              applyNativeTracks(tracks, status);
              setBuildTool("arrangement");
              setPage("build");
            }} />
          )}

          {project.setlist.songs.length > 0 && page === "build" && (
            <>
              <ToolRail
                items={buildNav}
                active={buildTool}
                onSelect={setBuildTool}
              />
              {buildTool === "arrangement" && <Arrangement song={selectedSong} audio={audio} onSongChange={setSelectedSong} onNativeLoaded={applyNativeTracks} onSave={() => void saveCurrentProject()} referencedSectionIds={new Set(project.video?.clips.map(clip => clip.sectionId).filter((id): id is string => Boolean(id)) ?? [])} />}
              {buildTool === "mixer" && <Mixer song={selectedSong} audio={audio} />}
              {buildTool === "pads" && <Pads initialPads={project.pads} initialPadCount={project.padCount} onChange={(pads, padCount) => setProject((current) => ({ ...current, pads, padCount, updatedAt: new Date().toISOString() }))} />}
              {buildTool === "lighting" && <Lighting song={selectedSong} lumarig={lumarig} />}
              {buildTool === "presentation" && (
                <PresentationEditor
                  song={selectedSong}
                  audio={audio}
                  proPresenter={proPresenter}
                  globalSectionFollowEnabled={integrationSettings.propresenter.followSections}
                  onSongChange={setSelectedSong}
                />
              )}
              {buildTool === "midi" && <MidiEditor settings={project.midi ?? { channel: 1 }} sections={selectedSong.sections} onSettingsChange={(midi) => setProject((current) => ({ ...current, midi, updatedAt: new Date().toISOString() }))} onSectionsChange={(sections) => { const song = { ...selectedSong, sections }; setSelectedSong(song); setProject((current) => ({ ...current, setlist: { ...current.setlist, songs: current.setlist.songs.map((item) => item.id === song.id ? song : item) }, updatedAt: new Date().toISOString() })); }} />}
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
                  onSelect={selectSetlistSong}
                  onAddSong={addServiceSong}
                  onRenameService={renameService}
                  onMoveItem={moveItem}
                  onRemoveItem={removeItem}
                  onNewService={newService}
                  onOpenProject={openStudioProject}
                  onSaveProject={() => void saveCurrentProject()}
                  error={projectError || audio.error || ""}
                  mediaCheck={mediaCheck}
                  onCheckMedia={() => void checkMedia()}
                  onOpenArrangement={() => { setBuildTool("arrangement"); setPage("build"); }}
                  onImport={() => setPage("import")}
                  onSongChange={setSelectedSong}
                  onStart={startPlayback}
                  onPause={pausePlayback}
                />
              )}
              {showTool === "connections" && <Connections audio={audio} remote={remote} lumarig={lumarig} song={selectedSong} onSongChange={setSelectedSong} onOpenAudio={()=>{setPage("build");setBuildTool("mixer")}} onOpenMidi={()=>{setPage("build");setBuildTool("midi")}} onOpenLighting={()=>{setPage("build");setBuildTool("lighting")}} onOpenIntegrations={()=>setShowTool("integrations")}/>}
              {showTool === "integrations" && (
                <IntegrationsPage
                  settings={integrationSettings}
                  proPresenter={proPresenter}
                  selectedSong={selectedSong}
                  existingSongs={project.setlist.songs}
                  onSettingsChange={(integrations) => setProject((current) => ({
                    ...current,
                    integrations,
                    updatedAt: new Date().toISOString()
                  }))}
                  onPlanningCenterImport={applyPlanningCenterImport}
                />
              )}
              {showTool === "settings" && (
                <>
                  <SettingsPage audio={audio} />
                  <div className="panel project-actions">
                    <strong>{project.name}</strong>
                    <span>{projectPath ?? "Unsaved Studio Project"}</span>
                    {projectError && <p role="alert" className="service-error">{projectError}</p>}
                    <button onClick={() => void newService()}>New Service</button>
                    <button onClick={() => void openStudioProject()}>Open Project</button>
                    <button onClick={() => void saveCurrentProject(false)}>Save Project</button>
                    <button onClick={() => void saveCurrentProject(true)}>Save As…</button>
                  </div>
                </>
              )}
            </>
          )}

          {project.setlist.songs.length > 0 && page === "live" && (<>
            <div className="live-layout-switch" role="group" aria-label="Live workspace"><button className={liveLayout==="session"?"active":""} onClick={()=>setLiveLayout("session")}>SESSION</button><button className={liveLayout==="performance"?"active":""} onClick={()=>setLiveLayout("performance")}>PERFORMANCE</button></div>
            {liveLayout === "session" ? <SessionView song={selectedSong} current={currentSection} queued={queuedManualSection} audio={audio} onLaunch={launchSection} onSongChange={setSelectedSong} onStop={stopPlayback}/> : <Performance
              song={selectedSong}
              current={currentSection}
              nextSong={adjacentSong(project.setlist, selectedSong.id, 1)}
              onNextSong={(song) => void selectSetlistSong(song)}
              remoteOnline={remote.status === "online"}
              remoteClients={remote.remoteClients}
              audio={audio}
              queuedManualSection={queuedManualSection}
              onLaunchSection={(index) => void launchSection(index)}
              proPresenter={proPresenter}
              onSongChange={setSelectedSong}
            />}
          </>)}
          </>}
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
        <div><strong>LUMA<span>STUDIO</span></strong><small>SHOW CONTROL · 0.4</small></div>
      </div>
      <nav className="workspace-nav">
        {workspaceNav.map(({ page: target, label, icon: Icon }) => (
          <button key={target} className={page === target ? "active" : ""} onClick={() => onPage(target)}>
            <Icon size={17} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom"><span>LUMA ECOSYSTEM</span><strong>STUDIO</strong><small>IMPORT → BUILD → SHOW → LIVE</small></div>
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

function MidiEditor({ settings, sections, onSettingsChange, onSectionsChange }: { settings: MidiSettings; sections: Song["sections"]; onSettingsChange: (settings: MidiSettings) => void; onSectionsChange: (sections: Song["sections"]) => void }) {
  const [ports, setPorts] = useState<MidiPort[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [testProgram, setTestProgram] = useState(0);
  const refresh = useCallback(async () => { try { setPorts(await listMidiOutputs()); setError(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function connect(index: number) {
    try { const name = await connectMidiOutput(index); onSettingsChange({ ...settings, outputIndex: index, outputName: name }); setConnected(true); setError(""); }
    catch (e) { setConnected(false); setError(e instanceof Error ? e.message : String(e)); }
  }
  return <section className="midi-editor">
    <div className="page-head"><div><h1>MIDI</h1><p>Route section changes and manual messages to hardware, IAC or virtual MIDI destinations.</p></div><button onClick={() => void refresh()}>Refresh Devices</button></div>
    {error && <div className="error-banner">{error}</div>}
    <div className="midi-grid">
      <div className="panel"><h2>Output</h2><label><span>Destination</span><select value={settings.outputIndex ?? ""} onChange={(e) => void connect(Number(e.currentTarget.value))}><option value="">Select MIDI output</option>{ports.map((port)=><option key={port.index} value={port.index}>{port.name}</option>)}</select></label><label><span>Default Channel</span><input type="number" min="1" max="16" value={settings.channel} onChange={(e)=>onSettingsChange({...settings,channel:Math.max(1,Math.min(16,Number(e.currentTarget.value)))})}/></label><p>{connected ? "Connected · " + settings.outputName : "Not connected"}</p><button disabled={!connected} onClick={() => void disconnectMidiOutput().then(()=>setConnected(false))}>Disconnect</button></div>
      <div className="panel"><h2>Test Output</h2><label><span>Program</span><input type="number" min="0" max="127" value={testProgram} onChange={(e)=>setTestProgram(Number(e.currentTarget.value))}/></label><button disabled={!connected} onClick={()=>void sendProgramChange(settings.channel,testProgram)}>Send Program Change</button><button disabled={!connected} onClick={()=>void sendControlChange(settings.channel,1,127)}>Send CC 1 · 127</button></div>
      <div className="panel midi-section-map"><h2>Section Patches</h2>{sections.map((section,index)=><label key={section.id}><span>{section.name}</span><input value={section.midiPatch ?? ""} placeholder={"e.g. 12@" + settings.channel} onChange={(e)=>onSectionsChange(sections.map((item,i)=>i===index?{...item,midiPatch:e.currentTarget.value||undefined}:item))}/><button disabled={!connected || !section.midiPatch} onClick={()=>section.midiPatch && void sendMidiPatch(section.midiPatch)}>Test</button></label>)}</div>
    </div>
  </section>;
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
    <div className="page-head"><div><h1>Video</h1><p>Timeline clips, section cues and local output window</p></div><button className="primary" onClick={() => void addLocal()}>Add MP4 / MOV</button></div>
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
    <div className="panel video-program-controls">
      {(["live","black","clear","freeze"] as VideoProgramState[]).map((state) => <button key={state} className={(value.state ?? "live") === state ? "active" : ""} onClick={() => onChange({...value,state})}>{state.toUpperCase()}</button>)}
      <button onClick={() => void openVideoOutput().catch(cause => setError(String(cause)))}>Open Output</button>
      <button onClick={() => void fullscreenVideoOutput(true).catch(cause => setError(String(cause)))}>Fullscreen</button>
    </div>
    <div className="panel video-output"><h2>Output routing</h2>
      <p>Open Output launches a local program window. Place that window on the intended display and verify the picture at the destination.</p>
      <p>NDI publishing and automatic display routing are unavailable in this build.</p>
      {value.output.ndiEnabled && <p className="audio-error">This project requests NDI, but no NDI sender is active.</p>}
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
  song, projectName, rigConnected,
  previewPlaying,
  onPreviewPlaying,
  audio,
  remoteOnline,
  onStart,
  onPause,
  onStop
}: {
  song: Song;
  projectName: string;
  rigConnected: boolean;
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
      : song.countIn.mode === "none" ? "COUNT OFF" : `${song.countIn.value} ${song.countIn.mode.toUpperCase()} COUNT`;

  return (
    <header className="transport">
      <div className="set-name" title={projectName}>{projectName}</div>
      <div className="tempo">
        <strong>{song.bpm.toFixed(1)}</strong>
        <span>BPM</span>
        <button disabled title="Tap tempo is not implemented. Edit song tempo in Arrangement.">TAP</button>
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
        label={audio.status.playing ? "Audio playing" : audio.hasLoadedAudio ? "Audio loaded" : "No audio loaded"}
        ok={Boolean(audio.status.initialized) && !audio.status.deviceError}
      />
      <Status label="LumaRig" ok={rigConnected} />
      <Status label="Remote" ok={remoteOnline} />
      <Gauge size={17} className="muted" />
      <span className="cpu">
        {audio.hasLoadedAudio
          ? fmtClock(audio.status.positionSeconds ?? 0) + " / " +
            fmtClock(audio.status.durationSeconds ?? 0)
          : "No audio position"}
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
  onAddSong,
  onRenameService,
  onMoveItem,
  onRemoveItem,
  onNewService,
  onOpenProject,
  onSaveProject,
  error,
  mediaCheck,
  onCheckMedia,
  onOpenArrangement,
  onImport,
  onSongChange,
  onStart,
  onPause
}: {
  selected: Song;
  setlist: Setlist;
  audio: AudioEngineController;
  onSelect: (song: Song) => void | Promise<boolean | void>;
  onAddSong: (title: string) => Promise<boolean>;
  onRenameService: (name: string) => boolean;
  onMoveItem: (id: string, direction: -1 | 1) => void;
  onRemoveItem: (id: string) => Promise<boolean>;
  onNewService: () => void | Promise<void>;
  onOpenProject: () => void | Promise<void>;
  onSaveProject: () => void;
  error: string;
  mediaCheck: { missing: string[]; checked: number; error?: string } | null;
  onCheckMedia: () => void;
  onOpenArrangement: () => void;
  onImport: () => void;
  onSongChange: (song: Song) => void;
  onStart: () => Promise<void>;
  onPause: () => Promise<void>;
}) {
  const nextSong = adjacentSong(setlist, selected.id, 1);
  const playing = Boolean(audio.status.playing);
  const busy = Boolean(audio.status.transitionActive || audio.status.countInActive);
  const [selecting, setSelecting] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [editingServiceName, setEditingServiceName] = useState(false);
  const [serviceNameDraft, setServiceNameDraft] = useState(setlist.name);
  const duration = audio.status.durationSeconds ?? 0;
  const position = audio.status.positionSeconds ?? 0;
  const progress = audio.hasLoadedAudio && duration > 0 ? Math.min(100, position / duration * 100) : 0;
  const transportState = busy ? "COUNT / TRANSITION" : playing ? "PLAYING" : audio.hasLoadedAudio ? "STOPPED · AUDIO LOADED" : "SELECTED · NO AUDIO LOADED";
  const select = async (song: Song) => { setSelecting(true); try { await onSelect(song); } finally { setSelecting(false); } };
  return <section className="service-desk">
    <header className="service-heading"><div><small>SERVICE / SHOW</small>{editingServiceName ? <form className="service-rename" onSubmit={event => { event.preventDefault(); if (onRenameService(serviceNameDraft)) setEditingServiceName(false); }}><input aria-label="Service name" value={serviceNameDraft} onChange={event => setServiceNameDraft(event.target.value)} autoFocus maxLength={100}/><button type="submit" disabled={!serviceNameDraft.trim()||playing||busy}>Save name</button><button type="button" onClick={() => setEditingServiceName(false)}>Cancel</button></form> : <div className="service-title"><h1>{setlist.name}</h1><button aria-label="Rename service" disabled={playing||busy} onClick={() => { setServiceNameDraft(setlist.name); setEditingServiceName(true); }}>Rename</button></div>}<p>Select an item to load its audio. Playback starts only when you press Play.</p></div><div className="service-actions"><button onClick={() => void onNewService()}>New Service</button><button onClick={() => void onOpenProject()}>Open</button><button onClick={onSaveProject}>Save</button><button className="primary" disabled={!setlist.songs.length} onClick={onImport}><Plus size={16}/> Import audio</button></div></header>
    {error && <p role="alert" className="service-error">{error}</p>}
    <div className="service-columns">
      <div className="panel service-order"><header><h2>Running order</h2><span>{setlist.songs.length} items · {fmt(setlist.songs.reduce((sum,song)=>sum+song.durationSeconds,0))}</span></header>
        <form className="service-add-item" onSubmit={event => { event.preventDefault(); if (!newTitle.trim() || selecting || playing || busy) return; setSelecting(true); void onAddSong(newTitle).then(added => { if (added) setNewTitle(""); }).finally(() => setSelecting(false)); }}><label htmlFor="service-new-item">Add a song or service item</label><div><input id="service-new-item" value={newTitle} onChange={event=>setNewTitle(event.target.value)} placeholder="e.g. Opening worship" disabled={selecting||playing||busy}/><button type="submit" disabled={!newTitle.trim()||selecting||playing||busy}>Add item</button></div></form>
        {!setlist.songs.length && <div className="service-empty"><strong>Start with your first item</strong><p>Add an item above, then prepare its arrangement and import audio. The service starts empty.</p></div>}
        {setlist.songs.map((song,index)=><div key={song.id} className="service-item-row"><button className={"service-item "+(song.id===selected.id?"selected":"")} disabled={playing||busy||selecting} onClick={()=>void select(song)}><span className="order-number">{String(index+1).padStart(2,"0")}</span><span><strong>{song.title}</strong><small>{song.artist || "No artist"} · {song.tracks.filter(t=>t.media?.path).length} audio files assigned</small></span><span>{song.bpm}<small>BPM</small></span><span>{song.key}<small>{song.meter.join("/")}</small></span><span className="item-state">{song.id===selected.id?"SELECTED":"LOAD"}</span></button><div className="service-item-actions"><button aria-label={`Move ${song.title} earlier`} title="Move earlier" disabled={index===0||playing||busy||selecting} onClick={()=>onMoveItem(song.id,-1)}>↑</button><button aria-label={`Move ${song.title} later`} title="Move later" disabled={index===setlist.songs.length-1||playing||busy||selecting} onClick={()=>onMoveItem(song.id,1)}>↓</button><button aria-label={`Remove ${song.title}`} title="Remove item" disabled={playing||busy||selecting} onClick={()=>{setSelecting(true);void onRemoveItem(song.id).finally(()=>setSelecting(false));}}>×</button></div></div>)}
        {(playing||busy)&&<p className="service-note">Pause playback before loading another item.</p>}
      </div>
      <aside className="panel service-transport"><span className={"service-state "+(playing?"playing":"")}>{selecting?"LOADING ITEM":setlist.songs.length?transportState:"EMPTY SERVICE"}</span><h2>{setlist.songs.length?selected.title:"No item selected"}</h2><p>{setlist.songs.length?`${selected.bpm} BPM · ${selected.key} · ${selected.meter.join("/")}`:"Add an item to begin preparing your service."}</p>
        <div className="service-progress" role="progressbar" aria-label="Audio position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{width:progress+"%"}}/></div><div className="service-times"><span>{fmtClock(position)}</span><span>{fmtClock(duration)}</span></div>
        <button className="service-play" disabled={!setlist.songs.length||!audio.hasLoadedAudio||selecting} onClick={()=>void(playing||busy?onPause():onStart())}>{playing||busy?"PAUSE / CANCEL":"PLAY LOADED AUDIO"}</button>
        {!audio.hasLoadedAudio&&<p className="service-note">Import or load audio before playback. No audio is currently ready.</p>}
        <div className="service-next"><small>NEXT IN RUNNING ORDER</small><strong>{nextSong?.title??"End of service"}</strong><span>{nextSong?"Not loaded. Select it when ready.":"No next item."}</span></div>
      </aside>
      <section className="panel service-preparation"><header><h2>Prepare selected item</h2><button onClick={onOpenArrangement}>Open arrangement →</button></header><div className="preparation-grid"><div><small>STRUCTURE</small><strong>{selected.sections.length} sections</strong><p>{selected.sections.map(section=>section.name).join(" → ") || "No sections defined"}</p></div><div><small>START COUNT-IN</small><div className="count-options">{([0,1,2] as const).map(bars=><button key={bars} disabled={playing||busy} className={(bars===0?selected.countIn.mode==="none":selected.countIn.mode==="bars"&&selected.countIn.value===bars)?"active":""} onClick={()=>onSongChange({...selected,countIn:bars===0?{mode:"none"}:{mode:"bars",value:bars}})}>{bars===0?"Off":bars+ (bars===1?" bar":" bars")}</button>)}</div><p>Applies to this item. Configure guide routing in Connections.</p></div></div></section>
      <aside className="panel service-health"><header><h2>Show readiness</h2><button onClick={onCheckMedia}>Check files</button></header><strong>{audio.status.deviceName??"No audio device initialized"}</strong><p>{audio.status.deviceError ? (audio.status.lastError || "Audio device is unavailable. Check the output device in Mixer.") : !audio.status.initialized ? "Load audio to initialize the native engine." : "Engine initialized. Validate the physical output before the show."}</p><div className="actual-meters">{([audio.status.peakLeft??0,audio.status.peakRight??0]).map((level,index)=><div key={index}><span>{index===0?"L":"R"}</span><meter min={0} max={1} value={level} aria-label={index===0?"Left audio peak":"Right audio peak"}/></div>)}</div><div className="service-file-check" aria-live="polite">{!mediaCheck ? "Media files have not been checked." : mediaCheck.error ? mediaCheck.error : mediaCheck.missing.length ? <><strong>{mediaCheck.missing.length} missing or empty media file{mediaCheck.missing.length===1?"":"s"}</strong><ul>{mediaCheck.missing.map(path=><li key={path} title={path}>{path.split(/[\\/]/).pop() || path}</li>)}</ul></> : mediaCheck.checked ? `${mediaCheck.checked} assigned media files found. Check audio routing and receivers separately.` : "No media files assigned yet."}</div></aside>
    </div>
  </section>;
}

function SongsPage({
  selected,
  setlist,
  onSelect,
  onOpenArrangement,
  onImport
}: {
  selected: Song;
  setlist: Setlist;
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
  audio,
  onSongChange,
  onNativeLoaded,
  onSave,
  referencedSectionIds
}: {
  song: Song;
  audio: AudioEngineController;
  onSongChange: (song: Song) => void;
  onNativeLoaded: (tracks: NativeAudioTrack[], status: NativeAudioStatus) => void;
  onSave: () => void;
  referencedSectionIds: Set<string>;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(song.title);
  const [artistDraft, setArtistDraft] = useState(song.artist);
  const [bpmDraft, setBpmDraft] = useState(song.bpm);
  const [keyDraft, setKeyDraft] = useState(song.key);
  const [meterTopDraft, setMeterTopDraft] = useState(song.meter[0]);
  const [meterBottomDraft, setMeterBottomDraft] = useState(song.meter[1]);
  const [selectedSectionIndex, setSelectedSectionIndex] = useState(
    Math.min(4, Math.max(0, song.sections.length - 1))
  );
  const [nativeDropActive, setNativeDropActive] = useState(false);
  const selectedSection =
    song.sections[Math.min(selectedSectionIndex, song.sections.length - 1)];
  const sectionEditingLocked = Boolean(audio.status.playing || audio.status.transitionActive || audio.status.countInActive);
  const totalBars = Math.max(
    ...song.sections.map((section) => section.startBar + section.lengthBars - 1)
  );
  function addSection() {
    if (sectionEditingLocked || song.sections.length >= 128) return;
    const number = song.sections.length + 1;
    const next = { id: crypto.randomUUID(), name: `Section ${number}`, startBar: totalBars + 1, lengthBars: 8, color: "#638db0" };
    onSongChange(reflowSongSections(song, [...song.sections, next]));
    setSelectedSectionIndex(number - 1);
  }
  function updateSection(patch: Partial<Song["sections"][number]>) {
    if (sectionEditingLocked || !selectedSection) return;
    onSongChange(reflowSongSections(song, song.sections.map(section => section.id === selectedSection.id ? { ...section, ...patch } : section)));
  }
  function removeSection() {
    if (sectionEditingLocked || song.sections.length <= 1 || !selectedSection || referencedSectionIds.has(selectedSection.id)) return;
    if (!window.confirm(`Remove ${selectedSection.name} and its section cues from this song?`)) return;
    onSongChange(reflowSongSections(song, song.sections.filter(section => section.id !== selectedSection.id)));
    setSelectedSectionIndex(Math.max(0, selectedSectionIndex - 1));
  }

  async function importAudio(paths?: string[]) {
    const result = paths ? await audio.loadPaths(paths) : await audio.chooseAndLoad();
    if (result) onNativeLoaded(result.tracks, result.status);
  }
  async function toggleTrack(track: Song["tracks"][number], field: "solo" | "muted") {
    const id = track.media?.id;
    if (!id || !audio.tracks.some(media => media.id === id)) return;
    const next = !track[field];
    try {
      if (field === "solo") await audio.setTrackSolo(id, next);
      else await audio.setTrackMuted(id, next);
      onSongChange({ ...song, tracks: song.tracks.map(item => item.id === track.id ? { ...item, [field]: next } : item) });
    } catch { /* Native status exposes the error; do not claim the toggle changed. */ }
  }

  function assignMedia(trackId: string, mediaId: string) {
    const media = audio.tracks.find((item) => item.id === mediaId);
    if (!media) return;
    onSongChange({
      ...song,
      tracks: song.tracks.map((track) =>
        track.id === trackId
          ? { ...track, media: { id: media.id, path: media.path, startSeconds: media.startSeconds } }
          : track
      )
    });
  }

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWebviewWindow().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setNativeDropActive(true);
        return;
      }
      if (event.payload.type === "drop") {
        setNativeDropActive(false);
        void importAudio(event.payload.paths);
        return;
      }
      setNativeDropActive(false);
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; });
    return () => { disposed = true; unlisten?.(); };
  }, [audio.loadPaths, onNativeLoaded]);

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
          {editingTitle ? <form className="arrangement-metadata" onSubmit={event => { event.preventDefault(); if (!titleDraft.trim() || !keyDraft.trim() || !Number.isInteger(bpmDraft) || bpmDraft < 20 || bpmDraft > 300 || !Number.isInteger(meterTopDraft) || meterTopDraft < 1 || meterTopDraft > 16 || ![2,4,8,16].includes(meterBottomDraft)) return; onSongChange({ ...song, title: titleDraft.trim(), artist: artistDraft.trim(), bpm: bpmDraft, key: keyDraft.trim(), meter: [meterTopDraft,meterBottomDraft] }); setEditingTitle(false); }}><label>Title<input value={titleDraft} onChange={event => setTitleDraft(event.target.value)} autoFocus required/></label><label>Artist<input value={artistDraft} onChange={event => setArtistDraft(event.target.value)}/></label><label>Tempo<input type="number" min="20" max="300" value={bpmDraft} onChange={event=>setBpmDraft(Number(event.target.value))} required/></label><label>Key<input value={keyDraft} onChange={event=>setKeyDraft(event.target.value)} required/></label><label>Meter<input type="number" min="1" max="16" value={meterTopDraft} onChange={event=>setMeterTopDraft(Number(event.target.value))} required/></label><label>Beat unit<select value={meterBottomDraft} onChange={event=>setMeterBottomDraft(Number(event.target.value))}>{[2,4,8,16].map(value=><option key={value} value={value}>{value}</option>)}</select></label><button type="submit" disabled={!titleDraft.trim()||!keyDraft.trim()}>Apply details</button><button type="button" onClick={() => setEditingTitle(false)}>Cancel</button></form> : <h1>{song.title}</h1>}
          <p>
            {song.bpm} BPM · {song.key} · {song.meter.join("/")} · {fmt(song.durationSeconds)}
          </p>
        </div>
        <div className="head-actions">
          <button onClick={() => void importAudio()}>Import Audio</button>
          <button onClick={() => { setTitleDraft(song.title); setArtistDraft(song.artist); setBpmDraft(song.bpm); setKeyDraft(song.key); setMeterTopDraft(song.meter[0]); setMeterBottomDraft(song.meter[1]); setEditingTitle(true); }}>Edit details</button>
          <button className="primary" onClick={onSave}>Save Project</button>
        </div>
      </div>

      <div className={nativeDropActive ? "panel arrangement-media-bin drop-active" : "panel arrangement-media-bin"}>
        <div>
          <small>MEDIA BIN</small>
          <strong>{audio.tracks.length ? audio.tracks.length + " imported audio files" : "Drop WAV / MP3 / AIFF here"}</strong>
          <span>Import once, then drag a file onto the track lane that should play it.</span>
        </div>
        <div className="arrangement-media-items">
          {audio.tracks.map((media) => (
            <div
              key={media.id}
              className="arrangement-media-item"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("application/x-lumastudio-audio", media.id);
              }}
            >
              <i style={{ background: media.color }} />
              <strong>{media.name}</strong>
              <span>{media.kind}</span>
              <select defaultValue="" onChange={(event) => {
                if (event.currentTarget.value) assignMedia(event.currentTarget.value, media.id);
                event.currentTarget.value = "";
              }}>
                <option value="">Assign to…</option>
                {song.tracks.filter((track) => !["lighting","video","midi"].includes(track.kind)).map((track) => (
                  <option key={track.id} value={track.id}>{track.name}</option>
                ))}
              </select>
            </div>
          ))}
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
          <button type="button" onClick={addSection} disabled={sectionEditingLocked||song.sections.length>=128} title="Add a section after the current arrangement">+ Section</button>
        </div>

        {song.tracks.map((track, index) => {
          const acceptsAudio = !["lighting","video","midi"].includes(track.kind);
          const assignedMedia = track.media ? audio.tracks.find((media) => media.id === track.media?.id) : undefined;
          return (
            <div className="track-lane" key={track.id}>
              <div className="track-label">
                <button title="Solo this loaded track" aria-label={`Solo ${track.name}`} className={track.solo?"active":""} disabled={!track.media || !assignedMedia} onClick={() => void toggleTrack(track,"solo")}>S</button>
                <button title="Mute this loaded track" aria-label={`Mute ${track.name}`} className={track.muted?"active":""} disabled={!track.media || !assignedMedia} onClick={() => void toggleTrack(track,"muted")}>M</button>
                <span style={{ color: track.color }}>{track.name}</span>
                {track.media && <small title={track.media.path}>{assignedMedia?.name ?? track.media.path.split(/[\\/]/).pop()}</small>}
              </div>
              <div
                className={"lane lane-" + track.kind + (acceptsAudio ? " audio-drop-lane" : "") + (track.media ? " assigned" : "")}
                onDragOver={(event) => { if (acceptsAudio) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
                onDrop={(event) => {
                  if (!acceptsAudio) return;
                  event.preventDefault();
                  const mediaId = event.dataTransfer.getData("application/x-lumastudio-audio");
                  if (mediaId) assignMedia(track.id, mediaId);
                }}
              >
                {track.kind === "lighting" ? (
                  <span className="audio-clip-label">Lighting cues are configured per section</span>
                ) : track.kind === "video" ? (
                  <span className="audio-clip-label">Video is configured in the Video editor</span>
                ) : track.media ? (
                  <span className="audio-clip-label">{assignedMedia?.name ?? "Assigned audio · load to verify"}</span>
                ) : (
                  <div className="audio-drop-placeholder">DROP AUDIO HERE</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedSection && (
        <div className="inspector panel">
          <div className="section-structure-editor"><label>Section name<input aria-label="Section name" value={selectedSection.name} maxLength={64} disabled={sectionEditingLocked} onChange={event => updateSection({ name: event.target.value })}/></label><label>Bars<input aria-label="Section length in bars" type="number" min="1" max="512" value={selectedSection.lengthBars} disabled={sectionEditingLocked} onChange={event => { const lengthBars = Number(event.target.value); if (Number.isInteger(lengthBars) && lengthBars >= 1 && lengthBars <= 512) updateSection({ lengthBars }); }}/></label><button type="button" onClick={removeSection} disabled={sectionEditingLocked||song.sections.length<=1||referencedSectionIds.has(selectedSection.id)} title={referencedSectionIds.has(selectedSection.id)?"Remove linked video cues before deleting this section":"Remove selected section"}>Remove section</button></div>
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

function Performance({
  song,
  current,
  nextSong,
  onNextSong,
  remoteOnline,
  remoteClients,
  audio,
  queuedManualSection,
  onLaunchSection,
  proPresenter,
  onSongChange
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
  proPresenter: ReturnType<typeof useProPresenter>;
  onSongChange: (song: Song) => void;
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
  const presentation = song.presentation ?? { mode: "manual" as const, cueLeadBeats: 0, cues: [] };
  const presenterMatches = Boolean(
    proPresenter.state.presentationName
    && normalizeProPresenterName(proPresenter.state.presentationName) === normalizeProPresenterName(song.title)
  );

  function setPresentationMode(mode: "manual" | "section-follow" | "full-auto") {
    onSongChange({
      ...song,
      presentation: {
        ...presentation,
        mode
      }
    });
  }

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

      <div className="live-presentation-control panel">
        <div>
          <small>PRESENTATION</small>
          <strong>
            {proPresenter.state.connected
              ? proPresenter.state.presentationName ?? "ProPresenter connected"
              : "ProPresenter offline"}
          </strong>
          <span>
            {proPresenter.state.connected
              ? [
                  proPresenter.state.currentGroup,
                  proPresenter.state.slideIndex !== undefined ? "Slide " + (proPresenter.state.slideIndex + 1) : undefined,
                  presenterMatches ? "Matched" : "Different presentation"
                ].filter(Boolean).join(" · ")
              : "Studio will not send presentation commands."}
          </span>
        </div>
        <div className="live-presentation-modes">
          <button className={presentation.mode === "manual" ? "active manual" : ""} onClick={() => setPresentationMode("manual")}>
            TAKE MANUAL
          </button>
          <button className={presentation.mode === "section-follow" ? "active" : ""} onClick={() => setPresentationMode("section-follow")}>
            SECTION FOLLOW
          </button>
          <button
            className={presentation.mode === "full-auto" ? "active" : ""}
            disabled={presentation.cues.length === 0}
            onClick={() => setPresentationMode("full-auto")}
          >
            FULL AUTO
          </button>
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

function makePadSlots(initialPads?: PadSlot[]): PadSlot[] {
  const defaults: PadSlot[] = Array.from(
    { length: 16 },
    (_, index) => padNames[index] ?? `Pad ${index + 1}`
  ).map((name, index): PadSlot => ({
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
}

function Pads({ initialPads, initialPadCount, onChange }: { initialPads?: PadSlot[]; initialPadCount?: 12 | 16; onChange: (pads: PadSlot[], padCount: 12 | 16) => void }) {
  const [active, setActive] = useState(0);
  const [padCount, setPadCount] = useState<12 | 16>(initialPadCount ?? 12);
  const [playing, setPlaying] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [pads, setPads] = useState<PadSlot[]>(() => makePadSlots(initialPads));
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
              <span className="pad-source-label">{slot.path ? slot.path.split(/[\\/]/).pop() : "Assign a file"}</span>
              <strong>{slot.name}</strong>
              <small>{slot.path ? slot.mode : "Empty"}</small>
            </button>
          ))}
        </div>

        <div className="panel pad-inspector">
          <small>PAD {active + 1}</small>
          <h2>{pad.name}</h2>
          <p className="pad-source-label">{pad.path ? pad.path.split(/[\\/]/).pop() : "No audio file assigned"}</p>
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
          const nativeId = track.media?.id ?? track.id;
          const live = audio.tracks.some((nativeTrack) => nativeTrack.id === nativeId);
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
                    void audio.setTrackGain(nativeId, Number(event.currentTarget.value));
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
                    void audio.setTrackSolo(nativeId, next);
                  }}
                >
                  S
                </button>
                <button
                  className={muted ? "channel-toggle active danger" : "channel-toggle"}
                  disabled={!live}
                  onClick={() => {
                    const next = toggleSet(mutedTracks, track.id, setMutedTracks);
                    void audio.setTrackMuted(nativeId, next);
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
          <div className="light-lane"><strong>Section cues</strong><div>{song.sections.map(section => <span key={section.id} title={section.name} className="light-cue-label">{section.lightingCue || "No cue"}</span>)}</div></div>
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

function Connections({ audio, remote, lumarig, song, onSongChange, onOpenAudio, onOpenMidi, onOpenLighting, onOpenIntegrations }: {
  audio: AudioEngineController;
  remote: ReturnType<typeof useRemoteRelay>;
  lumarig: ReturnType<typeof useLumaRig>;
  song: Song;
  onSongChange: (song: Song) => void;
  onOpenAudio: () => void;
  onOpenMidi: () => void;
  onOpenLighting: () => void;
  onOpenIntegrations: () => void;
}) {
  const cards = [
    [
      "Audio I/O",
      audio.status.deviceName ?? "Default system output",
      audio.status.sampleRate
        ? audio.status.sampleRate.toLocaleString() + " Hz · native engine"
        : "Initialize by loading a multitrack"
    ],
    ["MIDI", "Check MIDI settings", "Device availability is not monitored here"],
    ["Clock Sync", "Studio song tempo", "External clock lock is not monitored"],
    ["Lighting", lumarig.peer?.name ?? "LumaRig", lumarig.state === "connected" ? `Loopback · protocol 1 · ${lumarig.latencyMs ?? "?"} ms handshake` : lumarig.error || "No Rig session connected"],
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
                      : title === "MIDI" || title === "Clock Sync"
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
                    : title === "Lighting"
                      ? lumarig.state === "connected" ? "Connected" : lumarig.state === "connecting" ? "Connecting" : "Offline"
                      : title === "MIDI" ? "Not verified" : "Internal"}
              </span>
            </div>
            <strong>{value}</strong>
            <p>{detail}</p>
            <button onClick={[onOpenAudio,onOpenMidi,onOpenMidi,onOpenLighting,onOpenIntegrations][index]}>Open settings</button>
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
          <p>Check the audio device, loaded stems, count-in route and external connections before a service. A performance lock is not currently enforced.</p>
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

function ImportWizard({ audio, onNativeLoaded, onClose }: {
  audio: AudioEngineController;
  onNativeLoaded: (tracks: NativeAudioTrack[], status: NativeAudioStatus) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  async function importMultitrack() {
    if (working) return;
    setWorking(true); setError('');
    try {
      const result = await audio.chooseAndLoad();
      if (result) onNativeLoaded(result.tracks, result.status);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setWorking(false); }
  }
  return <div className="modal-backdrop"><div className="import-modal panel native-import">
    <div className="modal-head"><div><small>MEDIA / MULTITRACK</small><h2>Import audio files</h2></div><button aria-label="Close import" disabled={working} onClick={onClose}>×</button></div>
    <div className="native-import-body"><Upload size={32}/><h3>Choose your song’s audio</h3><p>The native file picker loads files into the audio engine and assigns them to the selected song. Confirm alignment and output routing in Build after import.</p>
    <button className="primary" disabled={working || audio.busy} onClick={() => void importMultitrack()}>{working || audio.busy ? 'LOADING AUDIO…' : 'CHOOSE AUDIO FILES'}</button>
    {(error || audio.error) && <p className="audio-error" role="alert">{error || audio.error}</p>}
    <small>Stem separation, automatic tempo/key analysis and section detection are not included in this import.</small></div>
  </div></div>;
}
