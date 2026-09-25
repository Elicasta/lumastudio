import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AudioEngineController } from "../hooks/useAudioEngine";
import { buildMidiClipFromRecording } from "../domain/midiRecording";
import type {
  PluginInstance,
  PluginReference,
  Song,
  Track
} from "../domain/types";
import {
  connectMidiInput,
  scanMidiDevices,
  startMidiRecording,
  stopMidiRecording,
  cancelMidiRecording,
  type MidiPort
} from "../services/midi";
import {
  getAudioUnitParameters,
  loadAudioUnitInstrument,
  saveAudioUnitState,
  scanAudioUnits,
  setAudioUnitParameter,
  testInstrumentNote,
  unloadAudioUnitInstrument,
  type AudioUnitParameter,
  type AudioUnitPluginInfo
} from "../services/plugins";

type InspectorTab = "instrument" | "midi" | "fx";

export function InstrumentTrackInspector({
  song,
  track,
  audio,
  onTrackChange
}: {
  song: Song;
  track: Track;
  audio: AudioEngineController;
  onTrackChange: (track: Track) => void;
}) {
  const [tab, setTab] = useState<InspectorTab>("instrument");
  const [plugins, setPlugins] = useState<AudioUnitPluginInfo[]>([]);
  const [parameters, setParameters] = useState<AudioUnitParameter[]>([]);
  const [midiInputs, setMidiInputs] = useState<MidiPort[]>([]);
  const [selectedMidiInput, setSelectedMidiInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const recordingStartSeconds = useRef(0);

  const pluginInstance =
    track.instrument?.mode === "plugin" ? track.instrument.plugin : undefined;

  const instruments = useMemo(
    () => plugins.filter((plugin) => plugin.category === "instrument"),
    [plugins]
  );

  const visibleParameters = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query
      ? parameters.filter((parameter) => parameter.name.toLowerCase().includes(query))
      : parameters;
  }, [filter, parameters]);

  const scan = useCallback(async () => {
    setError("");
    try {
      const [installed, midi] = await Promise.all([
        scanAudioUnits(),
        scanMidiDevices()
      ]);
      setPlugins(installed);
      setMidiInputs(midi.inputs);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  useEffect(() => {
    setSelectedMidiInput(track.midiInputName ?? "");
  }, [track.id, track.midiInputName]);

  useEffect(() => {
    const plugin = pluginInstance?.plugin;
    if (!plugin || plugin.format !== "audio-unit") {
      setParameters([]);
      return;
    }

    if (audio.status.instrument?.identifier === plugin.identifier) {
      void getAudioUnitParameters()
        .then(setParameters)
        .catch((cause) => setError(messageOf(cause)));
      return;
    }

    const native = nativePluginFromReference(plugin);
    if (!native) {
      setError("This Audio Unit reference is missing its native component identity.");
      return;
    }

    let disposed = false;
    setBusy(true);
    void loadAudioUnitInstrument(native, pluginInstance?.state)
      .then(async () => {
        if (disposed) return;
        await audio.refresh();
        const next = await getAudioUnitParameters();
        if (!disposed) setParameters(next);
      })
      .catch((cause) => {
        if (!disposed) setError(messageOf(cause));
      })
      .finally(() => {
        if (!disposed) setBusy(false);
      });

    return () => {
      disposed = true;
    };
  }, [
    audio.refresh,
    audio.status.instrument?.identifier,
    pluginInstance?.plugin,
    pluginInstance?.state
  ]);

  async function choosePlugin(identifier: string) {
    const plugin = instruments.find((item) => item.identifier === identifier);
    if (!plugin) return;

    setBusy(true);
    setError("");
    try {
      await loadAudioUnitInstrument(plugin);
      await audio.refresh();
      const nextParameters = await getAudioUnitParameters();
      setParameters(nextParameters);

      const instance: PluginInstance = {
        id: crypto.randomUUID(),
        plugin: referenceFromNative(plugin),
        bypassed: false,
        parameters: nextParameters.map((parameter) => ({
          id: String(parameter.id),
          value: parameter.value
        }))
      };

      onTrackChange({
        ...track,
        sourceType: "instrument",
        kind: "midi",
        instrument: { mode: "plugin", plugin: instance },
        midiClips: track.midiClips ?? [],
        effects: track.effects ?? []
      });

      await captureState(instance);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function captureState(base = pluginInstance) {
    if (!base) return;
    try {
      const state = await saveAudioUnitState();
      onTrackChange({
        ...track,
        instrument: {
          mode: "plugin",
          plugin: {
            ...base,
            state,
            parameters: parameters.map((parameter) => ({
              id: String(parameter.id),
              value: parameter.value
            }))
          }
        }
      });
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function updateParameter(parameter: AudioUnitParameter, value: number) {
    const bounded = Math.max(parameter.min, Math.min(parameter.max, value));
    setParameters((current) =>
      current.map((item) =>
        item.id === parameter.id ? { ...item, value: bounded } : item
      )
    );

    try {
      await setAudioUnitParameter(parameter.id, bounded);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function connectInput(port: MidiPort) {
    setError("");
    try {
      const name = await connectMidiInput(port.index);
      setSelectedMidiInput(name);
      onTrackChange({ ...track, midiInputName: name });
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function toggleRecording() {
    if (recording) {
      setBusy(true);
      setError("");
      try {
        const messages = await stopMidiRecording();
        const clip = buildMidiClipFromRecording(
          song,
          "Instrument Take " + ((track.midiClips?.length ?? 0) + 1),
          recordingStartSeconds.current,
          messages
        );

        if (clip.events.length > 0) {
          onTrackChange({
            ...track,
            midiClips: [...(track.midiClips ?? []), clip]
          });
        }
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setRecording(false);
        setBusy(false);
      }
      return;
    }

    if (!track.midiInputName) {
      setError("Select and connect a MIDI input before recording.");
      return;
    }

    setError("");
    try {
      recordingStartSeconds.current = audio.status.positionSeconds ?? 0;
      await startMidiRecording();
      setRecording(true);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function removeInstrument() {
    setBusy(true);
    setError("");
    try {
      await cancelMidiRecording();
      if (audio.status.instrument) {
        await unloadAudioUnitInstrument();
        await audio.refresh();
      }
      setRecording(false);
      setParameters([]);
      onTrackChange({
        ...track,
        sourceType: "midi",
        instrument: undefined
      });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="track-device-panel panel">
      <header className="track-device-header">
        <div>
          <small>SELECTED TRACK</small>
          <strong>{track.name}</strong>
          <span>{pluginInstance?.plugin.name ?? "No instrument loaded"}</span>
        </div>
        <div className="track-device-tabs" role="tablist">
          <button className={tab === "instrument" ? "active" : ""} onClick={() => setTab("instrument")}>Instrument</button>
          <button className={tab === "midi" ? "active" : ""} onClick={() => setTab("midi")}>MIDI</button>
          <button className={tab === "fx" ? "active" : ""} onClick={() => setTab("fx")}>FX</button>
        </div>
      </header>

      {error && <p className="audio-error" role="alert">{error}</p>}

      {tab === "instrument" && (
        <div className="device-instrument-pane">
          <aside className="plugin-browser">
            <div className="plugin-browser-title">
              <div>
                <small>AUDIO UNIT INSTRUMENT</small>
                <strong>{pluginInstance?.plugin.name ?? "Choose Instrument"}</strong>
              </div>
              <button disabled={busy} onClick={() => void scan()}>Rescan</button>
            </div>

            <select
              aria-label="Audio Unit instrument"
              value={pluginInstance?.plugin.identifier ?? ""}
              disabled={busy}
              onChange={(event) => {
                if (event.currentTarget.value) void choosePlugin(event.currentTarget.value);
              }}
            >
              <option value="">Select installed instrument…</option>
              {groupPlugins(instruments).map(([manufacturer, items]) => (
                <optgroup key={manufacturer} label={manufacturer}>
                  {items.map((plugin) => (
                    <option key={plugin.identifier} value={plugin.identifier}>
                      {plugin.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <div className="plugin-meta">
              <span>{instruments.length} installed AU instrument{instruments.length === 1 ? "" : "s"}</span>
              {audio.status.instrument && (
                <span className={audio.status.instrumentRenderError ? "muted" : "ready"}>
                  {audio.status.instrumentRenderError ? "Render error" : "Audio live"}
                </span>
              )}
            </div>

            <div className="plugin-actions">
              <button disabled={!audio.status.instrument || busy} onClick={() => void testInstrumentNote()}>
                Test C3
              </button>
              <button disabled={!pluginInstance || busy} onClick={() => void captureState()}>
                Capture State
              </button>
              <button disabled={!pluginInstance || busy} onClick={() => void removeInstrument()}>
                Remove
              </button>
            </div>
          </aside>

          <div className="plugin-parameters">
            <div className="plugin-parameter-head">
              <div>
                <small>PLUGIN CONTROLS</small>
                <strong>{parameters.length ? parameters.length + " parameters" : "No parameters exposed"}</strong>
              </div>
              <input
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
                placeholder="Filter controls"
                aria-label="Filter plugin controls"
              />
            </div>

            <div className="plugin-parameter-grid">
              {visibleParameters.map((parameter) => (
                <label key={parameter.id} className="plugin-parameter">
                  <span title={parameter.name}>{parameter.name}</span>
                  <input
                    type="range"
                    min={parameter.min}
                    max={parameter.max}
                    step={parameterStep(parameter)}
                    value={parameter.value}
                    onChange={(event) => void updateParameter(parameter, Number(event.currentTarget.value))}
                    onPointerUp={() => void captureState()}
                    onBlur={() => void captureState()}
                  />
                  <output>{formatParameter(parameter.value)}</output>
                </label>
              ))}
              {!visibleParameters.length && (
                <div className="plugin-empty">
                  {pluginInstance
                    ? "This instrument does not expose legacy AU parameters through the generic editor."
                    : "Choose an installed Audio Unit instrument. Arturia and Apple components appear here only when macOS registers them for third-party hosts."}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "midi" && (
        <div className="device-midi-pane">
          <div>
            <small>LIVE INPUT</small>
            <strong>{track.midiInputName ?? "No MIDI input connected"}</strong>
            <select
              value={midiInputs.find((input) => input.name === selectedMidiInput)?.index ?? ""}
              onChange={(event) => {
                const port = midiInputs.find((input) => input.index === Number(event.currentTarget.value));
                if (port) void connectInput(port);
              }}
            >
              <option value="">Select MIDI input…</option>
              {midiInputs.map((input) => (
                <option key={input.index + ":" + input.name} value={input.index}>
                  {input.name}
                </option>
              ))}
            </select>
            <p>MIDI feeds the hosted instrument live through the native audio engine.</p>
          </div>

          <div className="midi-record-card">
            <small>RECORD MIDI</small>
            <strong>{recording ? "Recording…" : (track.midiClips?.length ?? 0) + " takes"}</strong>
            <button
              className={recording ? "recording" : "primary"}
              disabled={busy}
              onClick={() => void toggleRecording()}
            >
              {recording ? "Stop Recording" : "Record"}
            </button>
            <p>Notes and expressive MIDI are stored as a clip against the song’s musical timeline. Recording is not quantized automatically.</p>
          </div>

          <div className="midi-take-list">
            {(track.midiClips ?? []).map((clip) => (
              <div key={clip.id}>
                <strong>{clip.name}</strong>
                <span>{clip.events.length} events · {clip.lengthBeats.toFixed(2)} beats</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "fx" && (
        <div className="device-fx-pane">
          <div>
            <small>INSERT CHAIN</small>
            <strong>{track.effects?.length ? track.effects.length + " inserts" : "No inserts"}</strong>
            <p>The track FX data model is active. Native Audio Unit effect processing is kept disabled until the effect render graph has a real input callback path, so Studio will not pretend an effect is processing when it is not.</p>
          </div>
          <div className="fx-chain">
            {(track.effects ?? []).map((slot, index) => (
              <div key={slot.id} className={slot.enabled ? "fx-slot" : "fx-slot bypassed"}>
                <span>{index + 1}</span>
                <strong>{slot.plugin.plugin.name}</strong>
              </div>
            ))}
            <button disabled title="Audio Unit effect hosting is the next native graph step">+ Add Effect</button>
          </div>
        </div>
      )}
    </section>
  );
}

function nativePluginFromReference(plugin: PluginReference): AudioUnitPluginInfo | null {
  if (
    plugin.componentType === undefined ||
    plugin.componentSubType === undefined ||
    plugin.componentManufacturer === undefined
  ) {
    return null;
  }

  return {
    identifier: plugin.identifier,
    name: plugin.name,
    manufacturer: plugin.vendor ?? "Unknown",
    typeName: "Audio Unit",
    version: plugin.version ?? "",
    category: "instrument",
    componentType: plugin.componentType,
    componentSubType: plugin.componentSubType,
    componentManufacturer: plugin.componentManufacturer,
    hasCustomView: Boolean(plugin.hasCustomView),
    sandboxSafe: true
  };
}

function referenceFromNative(plugin: AudioUnitPluginInfo): PluginReference {
  return {
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
  };
}

function groupPlugins(
  plugins: AudioUnitPluginInfo[]
): Array<[string, AudioUnitPluginInfo[]]> {
  const groups = new Map<string, AudioUnitPluginInfo[]>();

  for (const plugin of plugins) {
    const manufacturer = plugin.manufacturer || "Other";
    const items = groups.get(manufacturer) ?? [];
    items.push(plugin);
    groups.set(manufacturer, items);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([manufacturer, items]) => [
      manufacturer,
      [...items].sort((a, b) => a.name.localeCompare(b))
    ]);
}

function parameterStep(parameter: AudioUnitParameter): number {
  const span = Math.abs(parameter.max - parameter.min);
  if (!Number.isFinite(span) || span === 0) return 0.01;
  return Math.max(span / 1000, 0.0001);
}

function formatParameter(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
