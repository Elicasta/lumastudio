import { useState, type CSSProperties } from 'react';
import type { Song, Track } from '../domain/types';
import type { AudioEngineController } from '../hooks/useAudioEngine';
import { sessionSlotState, sessionTrackSuppression } from '../domain/session';

export function SessionView({ song, current, queued, audio, onLaunch, onSongChange, onStop }: {
  song: Song; current: number; queued: number | null; audio: AudioEngineController;
  onLaunch: (index: number) => Promise<void>;
  onSongChange: (song: Song) => void;
  onStop: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingTrack, setPendingTrack] = useState<string | null>(null);
  const stems = song.tracks.filter(track => !['lighting', 'video', 'midi'].includes(track.kind));
  const loaded = audio.hasLoadedAudio && Boolean(audio.status.initialized);
  const playing = Boolean(audio.status.playing);
  const available = (track: Track) => Boolean(track.media && audio.tracks.some(item => item.id === track.media?.id));
  const anyLoadedSolo = stems.some(track => available(track) && track.solo);
  const currentName = song.sections[current]?.name ?? 'No section';
  const nextName = song.sections[current + 1]?.name ?? 'End of arrangement';

  async function launch(index: number) {
    if (busy) return;
    setBusy(true); setError('');
    try { await onLaunch(index); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function toggle(track: Track, field: 'muted' | 'solo') {
    if (pendingTrack || !track.media || !available(track)) return;
    setPendingTrack(track.id); setError('');
    try {
      const value = !track[field];
      await (field === 'muted' ? audio.setTrackMuted(track.media.id, value) : audio.setTrackSolo(track.media.id, value));
      onSongChange({ ...song, tracks: song.tracks.map(item => item.id === track.id ? { ...item, [field]: value } : item) });
    } catch (cause) { setError(String(cause)); }
    finally { setPendingTrack(null); }
  }

  return <section className="session-desk">
    <header className="session-heading">
      <div><small>SESSION / SECTION LAUNCHER</small><h1>{song.title}</h1><p>{playing ? 'Launch queues a section using this song’s jump count-in.' : 'Choose a section to cue it, then press Play.'} Stems follow the section together.</p></div>
      <button className="session-stop" disabled={!loaded} title="Stops the song transport. Pad voices have separate controls." onClick={() => void onStop().catch(cause => setError(String(cause)))}>STOP SONG</button>
    </header>
    <div className="session-state-strip">
      <span>{loaded ? (playing ? '● AUDIO PLAYING' : '■ AUDIO STOPPED') : 'NO AUDIO LOADED'}</span>
      <span>{song.bpm} BPM · {song.meter.join('/')}</span>
      <span>{queued !== null ? 'QUEUED: ' + (song.sections[queued]?.name ?? 'Unknown') : 'NO SECTION QUEUED'}</span>
      <span>Jump count: {song.manualJumpCountIn.mode}</span>
    </div>
    <div className="session-cue-board" aria-label="Section transport state">
      <div className={playing ? 'current is-playing' : 'current'}><small>{playing ? 'CURRENT · PLAYING' : 'SELECTED · STOPPED'}</small><strong>{currentName}</strong><span>{loaded ? 'Shared song transport' : 'Audio must be loaded'}</span></div>
      <div className={queued !== null ? 'is-queued' : ''}><small>QUEUED JUMP</small><strong>{queued !== null ? song.sections[queued]?.name ?? 'Unknown section' : 'None'}</strong><span>{queued !== null ? 'Waiting for the scheduled transition' : 'Choose a section below to cue or launch'}</span></div>
      <div><small>NEXT IN ARRANGEMENT</small><strong>{nextName}</strong><span>Arrangement order · not a queued command</span></div>
    </div>
    {error && <p className="audio-error" role="alert">{error}</p>}
    {!loaded && <p className="session-empty">Load this song’s audio in Show before launching. Sections remain available for inspection.</p>}
    <div className="session-scroll"><div className="session-grid" style={{ gridTemplateColumns: `190px repeat(${Math.max(1, stems.length)},minmax(120px,1fr))` }}>
      <div className="session-corner"><strong>SECTIONS</strong><small>{song.sections.length} scenes</small></div>
      {stems.length ? stems.map(track => <div className="session-track-head" style={{ '--track-color': track.color } as CSSProperties} key={track.id}>
        <small>{track.kind.toUpperCase()}</small><strong>{track.name}</strong><span>{available(track) ? 'AUDIO LOADED' : track.media ? 'FILE ASSIGNED · NOT LOADED' : 'NO FILE'}</span>
      </div>) : <div className="session-track-head">No stems assigned</div>}
      {song.sections.map((section, index) => {
        const state = sessionSlotState(index, current, queued, loaded, playing);
        return <div className="session-scene-row" key={section.id}>
          <button className={'scene-launch ' + state} disabled={!loaded || busy || audio.busy} aria-label={`${playing ? 'Launch' : 'Cue'} ${section.name}`} onClick={() => void launch(index)}>
            <span className="scene-launch-symbol">{state === 'queued' ? '◷' : state === 'playing' ? '●' : '▶'}</span>
            <span><strong>{section.name}</strong><small>{state === 'stopped' ? 'CUED · STOPPED' : state.toUpperCase()} · {section.lengthBars} bars</small></span>
          </button>
          {stems.length ? stems.map(track => {
            const suppressed = sessionTrackSuppression(track, anyLoadedSolo);
            return <div key={track.id} className={'session-slot ' + (available(track) ? suppressed ? 'suppressed' : state : 'unloaded')} style={{ '--track-color': track.color } as CSSProperties}>
            <span>{track.media ? section.name : '—'}</span><small>{track.media ? 'Bar ' + section.startBar + ' · ' + section.lengthBars + ' bars' : 'No assigned media'}</small>
            {available(track) && suppressed && <em className="session-suppressed-label">{suppressed}</em>}
            {state === 'playing' && available(track) && !suppressed && <i />}
          </div>; }) : <div className="session-slot unloaded">Import audio to populate this song.</div>}
        </div>;
      })}
      <div className="session-corner"><strong>TRACK CONTROL</strong><small>Applied to loaded stems</small></div>
      {stems.length ? stems.map(track => <div key={track.id} className="session-track-control">
        <span>{track.gainDb.toFixed(1)} dB</span><div>
          <button aria-label={`Mute ${track.name}`} aria-pressed={track.muted} disabled={!available(track) || pendingTrack !== null} className={track.muted ? 'active' : ''} onClick={() => void toggle(track, 'muted')}>MUTE</button>
          <button aria-label={`Solo ${track.name}`} aria-pressed={track.solo} disabled={!available(track) || pendingTrack !== null} className={track.solo ? 'active' : ''} onClick={() => void toggle(track, 'solo')}>SOLO</button>
        </div>
      </div>) : <div />}
    </div></div>
    <p className="session-footnote">Section launch keeps multitracks aligned. Independent clip launching and per-clip loops are not available.</p>
  </section>;
}
