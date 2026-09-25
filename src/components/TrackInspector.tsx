import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioEngineController } from "../hooks/useAudioEngine";
import { buildMidiClipFromRecording } from "../domain/midiRecording";
import { buildInstrumentTimeline } from "../domain/instrumentTimeline";
import type { PluginInstance, Song, Track } from "../domain/types";
import {
  cancelMidiRecording,
  connectMidiInput,
  scanMidiDevices,
  startMidiRecording,
  stopMidiRecording,
  type MidiPort
} from "../services/midi";
import {
  getAudioUnitParameters,
  loadAudioUnitInstrument,
  openAudioUnitEditor,
  saveAudioUnitState,
  scanAudioUnits,
  setAudioUnitParameter,
  testInstrumentNote,
  type AudioUnitParameter,
  type AudioUnitPluginInfo
} from "../services/plugins";

type InspectorTab = "instrument" | "midi" | "fx";

export function TrackInspector({
  song,
  track,
  audio,
  onSongChange
}: {
  song: Song;
  track: Track;
  audio: AudioEngineController;
  onSongChange: (song: Song) => void;
}) {
  const [tab, setTab] = useState<InspectorTab>(
    track.sourceType === "instrument" ? "instrument" : "midi"
  );
  const [plugins, setPlugins] = useState<AudioUnitPluginInfo[]>([]);
  const [parameters, setParameters] = useState<AudioUnitParameter[]>([]);
  const [search, setSearch] = useState("");
  const [parameterSearch, setParameterSearch] = useState("");
  const [selectedPluginId, setSelectedPluginId] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [midiInputs, setMidiInputs] = useState<MidiPort[]>([]);
  const [connectedMidiInput, setConnectedMidiInput] = useState("");
  const [error, setError] = useState("");
  const recordStartSeconds = useRef(0);
  const startedTransport = useRef(false);
  const stateSaveTimer = useRef<number>();

  const assigned =
    track.instrument?.mode === "plugin" ? track.instrument.plugin : undefined;
  const activePlugin = audio.status.instrument;
  const active =
    Boolean(assigned) &&
    activePlugin?.identifier === assigned?.plugin.identifier;

  const instruments = useMemo(
    () => plugins.filter((plugin) => plugin.category === "instrument"),
    [plugins]
  );
  const filteredPlugins = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return instruments;
    return instruments.filter((plugin) =>
      [plugin.name, plugin.manufacturer, plugin.typeName]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [instruments, search]);

  const filteredParameters = useMemo(() => {
    const query = parameterSearch.trim().toLowerCase();
    const list = query
      ? parameters.filter((parameter) =>
          parameter.name.toLowerCase().includes(query)
        )
      : parameters;
    return list.slice(0, 160);
  }, [parameters, parameterSearch]);

  useEffect(() => {
    setTab(track.sourceType === "instrument" ? "instrument" : "midi");
    setSelectedPluginId(
      track.instrument?.mode === "plugin"
        ? track.instrument.plugin.plugin.identifier
        : ""
    );
    setParameters([]);
    setError("");
  }, [track.id]);

  useEffect(() => {
    return () => {
      if (stateSaveTimer.current) window.clearTimeout(stateSaveTimer.current);
      if (recording) void cancelMidiRecording();
    };
  }, [recording]);

  function updateTrack(updater: (current: Track) => Track) {
    const nextTrack = updater(track);
    const nextSong = {
      ...song,
      tracks: song.tracks.map((item) =>
        item.id === track.id ? nextTrack : item
      )
    };
    onSongChange(nextSong);
    return { track: nextTrack, song: nextSong };
  }

  async function scan() {
    setBusy(true);
    setError("");
    try {
      const [found, midi] = await Promise.all([
        scanAudioUnits(),
        scanMidiDevices()
      ]);
      setPlugins(found);
      setMidiInputs(midi.inputs);
      if (!selectedPluginId) {
        setSelectedPluginId(
          found.find((plugin) => plugin.category === "instrument")?.identifier ??
            ""
        );
      }

      if (track.midiInputName && track.midiInputName !== connectedMidiInput) {
        const savedInput = midi.inputs.find(
          (input) => input.name === track.midiInputName
        );
        if (savedInput) {
          const name = await connectMidiInput(savedInput.index);
          setConnectedMidiInput(name);
        }
      }
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void scan();
  }, []);

  async function load(plugin: AudioUnitPluginInfo) {
    setBusy(true);
    setError("");
    try {
      const restoreState =
        assigned?.plugin.identifier === plugin.identifier
          ? assigned.state
          : undefined;

      await loadAudioUnitInstrument(plugin, restoreState);
      await audio.refresh();

      const nextParameters = await getAudioUnitParameters();
      setParameters(nextParameters);

      let state: string | undefined;
      try {
        state = await saveAudioUnitState();
      } catch {
        state = undefined;
      }

      const instance: PluginInstance = {
        id:
          assigned?.plugin.identifier === plugin.identifier
            ? assigned.id
            : crypto.randomUUID(),
        plugin: {
          identifier: plugin.identifier,
          name: plugin.name,
          vendor: plugin.manufacturer,
          format: "audio-unit",
          category: "instrument",
          componentType: plugin.componentType,
          componentSubType: plugin.componentSubType,
          componentManufacturer: plugin.componentManufacturer,
          version: plugin.version,
          hasCustomView: plugin.hasCustomView
        },
        bypassed: false,
        state
      };

      const updated = updateTrack((current) => ({
        ...current,
        kind: "midi",
        sourceType: "instrument",
        instrument: { mode: "plugin", plugin: instance },
        midiClips: current.midiClips ?? [],
        effects: current.effects ?? []
      }));

      const timeline = buildInstrumentTimeline(updated.song, updated.track);
      await audio.syncInstrumentTimeline(
        timeline.events,
        timeline.durationSeconds
      );
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function activateAssigned() {
    if (!assigned) return;
    const plugin = instruments.find(
      (candidate) => candidate.identifier === assigned.plugin.identifier
    );
    if (!plugin) {
      setError(
        "The assigned Audio Unit is not registered on this Mac. Rescan after installing or authorizing it."
      );
      return;
    }
    await load(plugin);
  }

  async function removeInstrument() {
    setBusy(true);
    setError("");
    try {
      if (active) {
        await audio.unloadInstrument();
      } else {
        await audio.syncInstrumentTimeline([], 0);
      }
      setParameters([]);
      updateTrack((current) => ({
        ...current,
        sourceType: "midi",
        instrument: undefined
      }));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function refreshParameters() {
    if (!active) return;
    try {
      setParameters(await getAudioUnitParameters());
      setError("");
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function capturePluginState() {
    if (!active || !assigned) return;
    try {
      const state = await saveAudioUnitState();
      updateTrack((current) => {
        if (current.instrument?.mode !== "plugin") return current;
        return {
          ...current,
          instrument: {
            ...current.instrument,
            plugin: {
              ...current.instrument.plugin,
              state
            }
          }
        };
      });
    } catch {
      // Some Audio Units intentionally do not expose class-info state.
    }
  }

  function scheduleStateCapture() {
    if (stateSaveTimer.current) window.clearTimeout(stateSaveTimer.current);
    stateSaveTimer.current = window.setTimeout(() => {
      void capturePluginState();
    }, 350);
  }

  async function changeParameter(parameter: AudioUnitParameter, value: number) {
    if (!active) return;
    const safe = Math.max(parameter.min, Math.min(parameter.max, value));
    setParameters((current) =>
      current.map((item) =>
        item.id === parameter.id ? { ...item, value: safe } : item
      )
    );
    try {
      await setAudioUnitParameter(parameter.id, safe);
      scheduleStateCapture();
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function startRecording() {
    if (recording) return;
    setError("");
    try {
      if (!track.midiInputName) {
        throw new Error("Choose a MIDI input for this track before recording.");
      }

      if (connectedMidiInput !== track.midiInputName) {
        const port = midiInputs.find(
          (input) => input.name === track.midiInputName
        );
        if (!port) {
          throw new Error(
            "The saved MIDI input is not currently available. Rescan MIDI devices."
          );
        }
        const name = await connectMidiInput(port.index);
        setConnectedMidiInput(name);
      }

      recordStartSeconds.current = Math.max(
        0,
        audio.status.positionSeconds ?? 0
      );
      await startMidiRecording();
      startedTransport.current = !audio.status.playing;
      if (startedTransport.current) {
        await audio.playPause();
      }
      setRecording(true);
    } catch (cause) {
      setError(messageOf(cause));
      void cancelMidiRecording();
    }
  }

  async function stopRecording() {
    if (!recording) return;
    setBusy(true);
    setError("");
    try {
      const messages = await stopMidiRecording();
      setRecording(false);

      if (startedTransport.current && audio.status.playing) {
        await audio.playPause();
      }
      startedTransport.current = false;

      if (!messages.length) {
        setError("No MIDI events were captured in this take.");
        return;
      }

      const takeNumber = (track.midiClips?.length ?? 0) + 1;
      const clip = buildMidiClipFromRecording(
        song,
        track.name + " Take " + takeNumber,
        recordStartSeconds.current,
        messages
      );

      const updated = updateTrack((current) => ({
        ...current,
        midiClips: [...(current.midiClips ?? []), clip]
      }));

      if (active) {
        const timeline = buildInstrumentTimeline(updated.song, updated.track);
        const synced = await audio.syncInstrumentTimeline(
          timeline.events,
          timeline.durationSeconds
        );
        if (!synced) {
          throw new Error("The MIDI take was saved, but the instrument playback timeline could not be refreshed.");
        }
      }
    } catch (cause) {
      setError(messageOf(cause));
      void cancelMidiRecording();
      setRecording(false);
      startedTransport.current = false;
    } finally {
      setBusy(false);
    }
  }

  const selectedPlugin = instruments.find(
    (plugin) => plugin.identifier === selectedPluginId
  );

  return (
    <section className="track-inspector panel">
      <header className="track-inspector-head">
        <div>
          <small>SELECTED TRACK</small>
          <strong>{track.name}</strong>
          <span>{track.sourceType ?? track.kind}</span>
        </div>
        <nav aria-label="Track inspector">
          <button
            className={tab === "instrument" ? "active" : ""}
            onClick={() => setTab("instrument")}
          >
            Instrument
          </button>
          <button
            className={tab === "midi" ? "active" : ""}
            onClick={() => setTab("midi")}
          >
            MIDI
          </button>
          <button
            className={tab === "fx" ? "active" : ""}
            onClick={() => setTab("fx")}
          >
            FX
          </button>
        </nav>
      </header>

      {error && <p className="audio-error" role="alert">{error}</p>}

      {tab === "instrument" && (
        <div className="instrument-inspector">
          <aside className="plugin-browser">
            <div className="plugin-browser-head">
              <div>
                <small>AUDIO UNITS</small>
                <strong>{instruments.length} instruments</strong>
              </div>
              <button disabled={busy} onClick={() => void scan()}>
                Rescan
              </button>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search Arturia, Apple…"
              aria-label="Search installed Audio Units"
            />
            <div className="plugin-list">
              {filteredPlugins.map((plugin) => (
                <button
                  key={plugin.identifier}
                  className={
                    plugin.identifier === selectedPluginId ? "selected" : ""
                  }
                  onClick={() => setSelectedPluginId(plugin.identifier)}
                >
                  <span>{plugin.manufacturer}</span>
                  <strong>{plugin.name}</strong>
                  <small>
                    {plugin.hasCustomView ? "Custom UI" : "Parameters"} ·{" "}
                    {plugin.version || "version unknown"}
                  </small>
                </button>
              ))}
              {!busy && filteredPlugins.length === 0 && (
                <p>No registered instrument Audio Units match this search.</p>
              )}
            </div>
            <div className="plugin-browser-actions">
              <button
                className="primary"
                disabled={!selectedPlugin || busy}
                onClick={() => selectedPlugin && void load(selectedPlugin)}
              >
                {busy ? "Working…" : assigned ? "Load / Replace" : "Load Instrument"}
              </button>
            </div>
          </aside>

          <div className="instrument-device">
            <div className="instrument-device-title">
              <div>
                <small>INSTRUMENT</small>
                <h3>{assigned?.plugin.name ?? "No instrument assigned"}</h3>
                <p>
                  {assigned?.plugin.vendor ?? "Choose a registered Audio Unit from the browser."}
                </p>
              </div>
              <div className="instrument-device-actions">
                {assigned && !active && (
                  <button disabled={busy} onClick={() => void activateAssigned()}>
                    Activate
                  </button>
                )}
                {active && (
                  <>
                    <button onClick={() => void testInstrumentNote()}>
                      Test C4
                    </button>
                    {activePlugin?.hasCustomView && (
                      <button
                        onClick={() =>
                          void openAudioUnitEditor().catch((cause) =>
                            setError(messageOf(cause))
                          )
                        }
                      >
                        Open Plug-in UI
                      </button>
                    )}
                    <button onClick={() => void refreshParameters()}>
                      Refresh Controls
                    </button>
                  </>
                )}
                {assigned && (
                  <button disabled={busy} onClick={() => void removeInstrument()}>
                    Remove
                  </button>
                )}
              </div>
            </div>

            {active && (
              <>
                <div className="instrument-runtime-strip">
                  <span>● HOSTED</span>
                  <span>{audio.status.deviceName ?? "Audio device"}</span>
                  <span>
                    {audio.status.sampleRate?.toLocaleString() ?? "?"} Hz
                  </span>
                  {audio.status.instrumentRenderError && (
                    <b>Render error detected</b>
                  )}
                </div>
                <div className="parameter-tools">
                  <input
                    value={parameterSearch}
                    onChange={(event) =>
                      setParameterSearch(event.currentTarget.value)
                    }
                    placeholder="Find parameter"
                    aria-label="Find instrument parameter"
                  />
                  <span>
                    {filteredParameters.length}
                    {parameters.length > filteredParameters.length
                      ? " shown of " + parameters.length
                      : " parameters"}
                  </span>
                </div>
                <div className="parameter-grid">
                  {filteredParameters.map((parameter) => (
                    <label key={parameter.id}>
                      <span title={parameter.name}>{parameter.name}</span>
                      <input
                        type="range"
                        min={parameter.min}
                        max={parameter.max}
                        step={Math.max(
                          (parameter.max - parameter.min) / 1000,
                          0.0001
                        )}
                        value={parameter.value}
                        onChange={(event) =>
                          void changeParameter(
                            parameter,
                            Number(event.currentTarget.value)
                          )
                        }
                      />
                      <output>{formatParameter(parameter.value)}</output>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "midi" && (
        <div className="midi-track-inspector">
          <div className="midi-input-card">
            <small>MIDI INPUT</small>
            <h3>{track.midiInputName ?? "Choose Input"}</h3>
            <select
              value={
                midiInputs.find((input) => input.name === track.midiInputName)
                  ?.index ?? ""
              }
              onChange={(event) => {
                if (!event.currentTarget.value) return;
                const port = midiInputs.find(
                  (input) => input.index === Number(event.currentTarget.value)
                );
                if (!port) return;
                void connectMidiInput(port.index)
                  .then((name) => {
                    setConnectedMidiInput(name);
                    updateTrack((current) => ({
                      ...current,
                      midiInputName: name
                    }));
                  })
                  .catch((cause) => setError(messageOf(cause)));
              }}
            >
              <option value="">Select MIDI input…</option>
              {midiInputs.map((input) => (
                <option key={input.index + ":" + input.name} value={input.index}>
                  {input.name}
                </option>
              ))}
            </select>
            <div className="midi-input-status">
              <span className={
                track.midiInputName &&
                connectedMidiInput === track.midiInputName
                  ? "ready"
                  : "muted"
              }>
                {track.midiInputName &&
                connectedMidiInput === track.midiInputName
                  ? "● Listening"
                  : "Not connected"}
              </span>
              <button disabled={busy} onClick={() => void scan()}>
                Rescan
              </button>
            </div>
            <p>
              Use the MONTAGE keyboard port or any connected controller. Input
              monitoring feeds the hosted instrument even while transport is
              stopped.
            </p>
          </div>
          <div className="midi-record-card">
            <small>MIDI RECORDING</small>
            <h3>{recording ? "Recording…" : "Ready"}</h3>
            <p>
              Live input comes from the MIDI input selected in Studio. Recording
              preserves the performed timing and controller data.
            </p>
            <div>
              {!recording ? (
                <button
                  className="record-button"
                  disabled={busy || !active || !track.midiInputName}
                  onClick={() => void startRecording()}
                >
                  ● Record MIDI
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void stopRecording()}
                >
                  ■ Stop + Keep Take
                </button>
              )}
            </div>
          </div>
          <div className="midi-take-list">
            <small>REGIONS</small>
            {(track.midiClips ?? []).map((clip) => (
              <div key={clip.id}>
                <strong>{clip.name}</strong>
                <span>{clip.events.length} events</span>
                <span>{clip.lengthBeats.toFixed(2)} beats</span>
              </div>
            ))}
            {(track.midiClips ?? []).length === 0 && (
              <p>No MIDI takes on this track yet.</p>
            )}
          </div>
        </div>
      )}

      {tab === "fx" && (
        <div className="track-fx-inspector">
          <div>
            <small>INSERT CHAIN</small>
            <h3>Track FX</h3>
            <p>
              The track model already stores ordered plug-in inserts. Native AU
              effect processing will use the same host bridge after the
              instrument path is validated.
            </p>
          </div>
          <div className="fx-chain">
            {(track.effects ?? []).map((slot, index) => (
              <div key={slot.id}>
                <span>{index + 1}</span>
                <strong>{slot.plugin.plugin.name}</strong>
                <small>{slot.enabled ? "Enabled" : "Bypassed"}</small>
              </div>
            ))}
            {(track.effects ?? []).length === 0 && (
              <div className="fx-empty">No inserts</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatParameter(value: number) {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
