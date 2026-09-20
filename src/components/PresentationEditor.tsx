import { useMemo, useState } from "react";
import type { Song, PresentationCue, PresentationMode } from "../domain/types";
import { presentationAutomation, sortPresentationCues } from "../domain/presentation";
import { sectionIndexAtSeconds } from "../domain/timing";
import type { AudioEngineController } from "../hooks/useAudioEngine";
import type { ProPresenterController } from "../hooks/useProPresenter";
import { normalizeProPresenterName } from "../services/propresenter";

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const whole = Math.floor(safe % 60);
  const tenths = Math.floor((safe - Math.floor(safe)) * 10);
  return `${minutes}:${String(whole).padStart(2, "0")}.${tenths}`;
}

export function PresentationEditor({
  song,
  audio,
  proPresenter,
  globalSectionFollowEnabled,
  onSongChange
}: {
  song: Song;
  audio: AudioEngineController;
  proPresenter: ProPresenterController;
  globalSectionFollowEnabled: boolean;
  onSongChange: (song: Song) => void;
}) {
  const automation = presentationAutomation(song);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState("");

  const presentationMatches = useMemo(() => {
    if (!proPresenter.state.presentationName) return false;
    return normalizeProPresenterName(song.title)
      === normalizeProPresenterName(proPresenter.state.presentationName);
  }, [proPresenter.state.presentationName, song.title]);

  function updateAutomation(patch: Partial<typeof automation>) {
    onSongChange({
      ...song,
      presentation: {
        ...automation,
        ...patch
      }
    });
  }

  function setMode(mode: PresentationMode) {
    updateAutomation({ mode });
    if (mode === "manual") setRecording(false);
  }

  function addCue(action: PresentationCue["action"]) {
    const position = Math.max(0, audio.status.positionSeconds ?? 0);
    const cue: PresentationCue = {
      id: crypto.randomUUID(),
      atSeconds: Number(position.toFixed(3)),
      action
    };
    updateAutomation({ cues: sortPresentationCues([...automation.cues, cue]) });
    setNotice(`${action === "next" ? "Next" : "Previous"} cue captured at ${formatTime(position)}`);
  }

  async function tap(action: PresentationCue["action"]) {
    if (recording) addCue(action);

    if (!proPresenter.state.connected) {
      setNotice(recording ? "Cue saved. ProPresenter is offline, so no slide command was sent." : "ProPresenter is offline.");
      return;
    }

    if (!presentationMatches) {
      setNotice(
        recording
          ? "Cue saved. Slide command was held because ProPresenter is on a different presentation."
          : "Command held because ProPresenter is on a different presentation."
      );
      return;
    }

    try {
      if (action === "next") await proPresenter.next();
      else await proPresenter.previous();
      if (!recording) setNotice(action === "next" ? "Next slide sent." : "Previous slide sent.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function updateCue(id: string, patch: Partial<PresentationCue>) {
    updateAutomation({
      cues: sortPresentationCues(
        automation.cues.map((cue) => cue.id === id ? { ...cue, ...patch } : cue)
      )
    });
  }

  function cueSection(cue: PresentationCue) {
    const index = sectionIndexAtSeconds(song, cue.atSeconds);
    return song.sections[index]?.name ?? "Song";
  }

  return (
    <section className="presentation-editor">
      <div className="page-head">
        <div>
          <h1>Presentation</h1>
          <p>Keep ProPresenter aligned with this Song, then capture slide changes by tapping them during rehearsal.</p>
        </div>
        <span className={proPresenter.state.connected ? "integration-status ready" : "integration-status"}>
          {proPresenter.state.connected ? "PROPRESENTER CONNECTED" : "PROPRESENTER OFFLINE"}
        </span>
      </div>

      <div className="panel presentation-mode-card">
        <div>
          <small>AUTOMATION MODE</small>
          <strong>{automation.mode === "manual" ? "Manual" : automation.mode === "section-follow" ? "Section Follow" : "Full Auto"}</strong>
          <span>
            {automation.mode === "manual"
              ? "Studio observes ProPresenter but sends no automatic presentation commands."
              : automation.mode === "section-follow"
                ? "Studio follows Verse / Chorus / Bridge. A person still advances individual lyric slides."
                : "Studio follows sections and fires the recorded slide cues on the Song timeline."}
          </span>
        </div>
        <div className="presentation-mode-buttons">
          {([
            ["manual", "Manual"],
            ["section-follow", "Section Follow"],
            ["full-auto", "Full Auto"]
          ] as const).map(([mode, label]) => (
            <button key={mode} className={automation.mode === mode ? "active" : ""} onClick={() => setMode(mode)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {automation.mode !== "manual" && !globalSectionFollowEnabled && (
        <div className="integration-warning">
          Section following is disabled globally. Turn on “Follow Studio sections” in Show → Integrations → ProPresenter.
        </div>
      )}

      <div className="presentation-grid">
        <div className="panel presentation-live-card">
          <small>LIVE STATE</small>
          <div className="presentation-live-pair">
            <div>
              <span>Studio</span>
              <strong>{song.title}</strong>
            </div>
            <div className={presentationMatches ? "state-link matched" : "state-link"}>
              {presentationMatches ? "SYNC" : "CHECK"}
            </div>
            <div>
              <span>ProPresenter</span>
              <strong>{proPresenter.state.presentationName ?? "No active presentation"}</strong>
            </div>
          </div>
          <div className="presentation-live-meta">
            <span>{proPresenter.state.currentGroup ?? "No group"}</span>
            <span>
              {proPresenter.state.slideIndex !== undefined
                ? `Slide ${proPresenter.state.slideIndex + 1}${proPresenter.state.totalSlides ? ` / ${proPresenter.state.totalSlides}` : ""}`
                : "No active slide"}
            </span>
          </div>
          <div className="presenter-controls">
            <button disabled={!proPresenter.state.connected || !presentationMatches} onClick={() => void tap("previous")}>Previous Slide</button>
            <button className="primary" disabled={!proPresenter.state.connected || !presentationMatches} onClick={() => void tap("next")}>Next Slide</button>
          </div>
        </div>

        <div className="panel presentation-record-card">
          <small>REHEARSAL CAPTURE</small>
          <strong>{recording ? "Recording Slide Cues" : "Record Slide Cues"}</strong>
          <span>
            Play the Song, then tap NEXT CUE where each lyric slide should change. Studio stores the Song time and also advances ProPresenter when it is safely matched.
          </span>
          <button
            className={recording ? "recording" : "primary"}
            disabled={automation.mode !== "full-auto"}
            onClick={() => setRecording((current) => !current)}
          >
            {recording ? "Stop Recording" : "Record Slide Cues"}
          </button>
          <button
            className="presentation-cue-tap"
            disabled={!recording || !audio.status.playing}
            onClick={() => void tap("next")}
          >
            NEXT CUE
            <small>{formatTime(audio.status.positionSeconds ?? 0)}</small>
          </button>
          {!audio.status.playing && recording && <span className="presentation-hint">Start playback, then tap NEXT CUE.</span>}
        </div>
      </div>

      <div className="panel presentation-cue-settings">
        <div>
          <small>PLAYBACK LEAD</small>
          <strong>{automation.cueLeadBeats > 0 ? `${automation.cueLeadBeats} beats early` : automation.cueLeadBeats < 0 ? `${Math.abs(automation.cueLeadBeats)} beats late` : "On the captured beat"}</strong>
          <span>Shift all recorded slide cues without moving them individually.</span>
        </div>
        <input
          type="range"
          min="-2"
          max="2"
          step="0.25"
          value={automation.cueLeadBeats}
          onChange={(event) => updateAutomation({ cueLeadBeats: Number(event.currentTarget.value) })}
        />
        <input
          type="number"
          min="-2"
          max="2"
          step="0.25"
          value={automation.cueLeadBeats}
          onChange={(event) => updateAutomation({ cueLeadBeats: Math.max(-2, Math.min(2, Number(event.currentTarget.value) || 0)) })}
        />
      </div>

      {notice && <div className="integration-warning">{notice}</div>}

      <div className="panel presentation-cue-list">
        <div className="presentation-cue-list-head">
          <div>
            <small>SLIDE CUES</small>
            <strong>{automation.cues.length} recorded</strong>
          </div>
          <button disabled={automation.cues.length === 0} onClick={() => updateAutomation({ cues: [] })}>Clear All</button>
        </div>

        {automation.cues.length === 0 ? (
          <div className="presentation-empty">
            No slide cues yet. Choose Full Auto, play the Song, and record the lyric changes once.
          </div>
        ) : (
          automation.cues.map((cue, index) => (
            <div className="presentation-cue-row" key={cue.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <select value={cue.action} onChange={(event) => updateCue(cue.id, { action: event.currentTarget.value as PresentationCue["action"] })}>
                <option value="next">NEXT</option>
                <option value="previous">PREVIOUS</option>
              </select>
              <input
                type="number"
                min="0"
                max={song.durationSeconds}
                step="0.1"
                value={cue.atSeconds}
                onChange={(event) => updateCue(cue.id, { atSeconds: Math.max(0, Number(event.currentTarget.value) || 0) })}
              />
              <strong>{formatTime(cue.atSeconds)}</strong>
              <span>{cueSection(cue)}</span>
              <button onClick={() => updateAutomation({ cues: automation.cues.filter((item) => item.id !== cue.id) })}>Remove</button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
