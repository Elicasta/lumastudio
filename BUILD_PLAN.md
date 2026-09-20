# LumaRig Studio build plan

## Product contract

The product model is locked around:

**Setlist → Song Arrangement → Performance**

A Setlist contains Songs. A Song owns Tracks and a musical Arrangement. Sections/Locators are shared control points that drive audio, click, guide, MIDI, lighting, video, tempo overrides and follow actions.

## Phase 0 — foundation

- Tauri 2 + React + TypeScript desktop shell
- macOS app + DMG bundle configuration
- GitHub Actions CI
- GitHub Release workflow
- signed Tauri updater wiring
- core Song / Track / Section / Setlist domain model
- Setlist page
- Add Song wizard shell
- Analyze → Stem Split → Map Sections → Review flow
- Song Arrangement page
- Performance page
- 12-pad player UI
- Mixer UI
- Lighting workspace UI
- Connections UI
- settings + updater UI
- section helper tests

## Phase 1 — real audio engine

Goal: deterministic multitrack playback before adding clever features.

- Rust audio engine isolated from the React render loop
- sample-accurate synchronized stems
- play / stop / seek / loop
- click bus + guide bus
- per-track gain / mute / solo
- output routing
- waveform peak cache
- project persistence
- crash-safe autosave
- performance-state lock
- audio underrun telemetry
- tests for duplicate play, repeated GO, seek during playback, missing media and device loss

## Phase 2 — analysis + section mapping

- BPM / beat-grid analysis
- downbeat confirmation
- key detection
- meter model
- section tap workflow with bar snap
- manual drag / nudge
- optional section detection as a draft
- click generation
- guide sample engine

## Phase 3 — stem separation

Stem splitting must never run on the realtime audio thread.

- worker process abstraction
- local model adapter API
- quick split: drums / bass / vocals / music
- band split: drums / bass / vocals / guitar / keys / other
- progress / cancel / retry
- same-length, sample-aligned stem validation
- automatic Track mapping
- pause worker jobs when Performance Mode starts
- model downloads stored outside project files
- adapter boundary so the model can change without changing the DAW

## Phase 4 — MIDI + lighting + video

- MIDI device enumeration
- note / CC / program-change lanes
- MIDI clock / start / stop
- section-scoped MIDI events
- LumaRig adapter
- platform-neutral Art-Net / sACN / OSC output layer
- lighting cue + automation lanes
- video cue lane
- external video output
- deterministic ordering when one Section triggers audio + MIDI + lighting + video together

## Phase 5 — remote

Remote architecture is Studio-owned:

- Mac app creates the Supabase remote session
- Mac app generates and rotates the 6-digit pairing code
- Mac app broadcasts canonical Setlist / Song / Section / transport state
- companion devices only join a Studio-created session
- Supabase Realtime is transport, never the musical clock
- pairing sessions expire automatically
- iPad control surface
- iPhone compact remote
- current / next Song and Section
- GO / Previous Section / Next Section
- dedicated Previous Song / Next Song commands
- pads
- mixer subset
- blackout / stop-all safety actions
- connection-loss behavior
- optional LAN-direct transport can be added later without changing the command protocol

## Phase 6 — release hardening

- Apple Developer ID signing + notarization
- production updater key
- universal macOS DMG
- migration tests
- media relink workflow
- corrupted-project recovery
- release notes + rollback policy
- performance soak tests

## Non-negotiable architecture rules

1. The audio grid is not the database.
2. Song → Arrangement → Section is the source of truth.
3. Section events share one musical clock.
4. Realtime audio never waits on AI, disk scans, network I/O or UI work.
5. YouTube is a reference/playback source, not a path for downloading or modifying protected media.
6. Auto-detection proposes. The operator confirms.
7. Performance Mode favors safe, large, deterministic controls over editing.
