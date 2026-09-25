# LumaStudio Workstation Core

This branch intentionally narrows LumaStudio around music creation and deterministic multitrack playback.

## Product rule

Every feature in this phase must belong to one of these objects:

- Song
- Musical clock
- Locator / loop region
- Track
- Track instrument
- Track effect
- MIDI/audio device

Lighting, presentation, video-show control, and ecosystem automation remain outside the focused UI until the workstation core is dependable.

## Main workspace

```
Song / Tempo / Meter / Transport / Metronome / Count-in / Loop

Locator lane
Intro | Verse | Chorus | Bridge | Outro

Track area
- audio tracks and stem stacks
- MIDI tracks
- software-instrument tracks
- external-hardware MIDI tracks
- pad-instrument tracks

Bottom inspector
- selected track routing
- instrument
- MIDI input/output
- insert FX chain
- plugin editor
```

## Track types

### Audio

A timeline media track with waveform, start offset, gain, mute, solo, routing and insert effects.

### MIDI

A timeline of MIDI clips and events. The destination is either:

1. an external MIDI output + channel, or
2. a software instrument hosted by LumaStudio.

Live input is captured from a selected MIDI input. Recording must be written against the same musical clock used by the audio transport.

### Software instrument

A MIDI track with a hosted plugin instrument. On macOS the first supported host format is Audio Unit. VST3 support belongs behind the same plugin abstraction rather than in a separate product path.

The track stores plugin identity, preset/state and automation-ready parameter values.

### Pad instrument

The complete pad bank lives as one instrument on one track.

A pad slot owns:
- sample
- MIDI note
- trigger mode
- gain

The pad track itself can have normal track routing and insert FX. There is no separate global Pad workspace in the focused product.

## Plugin host

The UI must never report a plugin as active until the native host has instantiated it and the audio graph is processing it.

Required host behavior:

1. scan installed instruments and effects
2. identify format, manufacturer and stable component identity
3. instantiate an instrument/effect
4. route MIDI into instrument plugins
5. route plugin audio into the LumaStudio mixer
6. embed the plugin's editor when available
7. provide a generic parameter editor when no custom editor exists
8. persist plugin state with the project
9. restore plugin state before transport is armed
10. bypass/remove safely without breaking the audio graph

macOS first: Audio Unit instrument/effect hosting.
Cross-platform next: VST3 behind the same LumaStudio plugin model.

## Bottom track inspector

The lower pane follows the selected track.

```
[TRACK] [INSTRUMENT] [MIDI I/O] [FX]

Instrument
  Analog Lab V
  preset / plugin editor

FX
  1  EQ
  2  Compressor
  3  Reverb
  +  Add Effect
```

The pane can be resized vertically and hidden, similar to the lower device/editor areas in mature DAWs.

## Device handling

### MIDI

Enumerate both input and output ports. Do not hard-code a keyboard by product name.

Hardware with several USB ports must expose each OS port independently.

A MIDI track stores its output name and channel. Controller input is selected separately.

### Audio

Enumerate audio output devices instead of always binding to the system default.

Changing devices is blocked while transport or a scheduled transition is active. The native engine is rebuilt against the selected device and the loaded song is reloaded/resampled for the new device sample rate.

## Locators

Locators are operator navigation points, independent from structural Sections.

Each locator stores:
- name
- bar / beat
- optional color
- optional MIDI note or CC trigger

Examples:

- Intro
- Verse 1
- Chorus
- Bridge
- Vamp
- Outro

Clicking or MIDI-triggering a locator seeks to it according to the active jump/quantization policy.

## Loop region

The song owns one active arrangement loop region.

Loop boundaries are musical positions rather than raw seconds.

A useful workflow is:

1. select Chorus locator
2. choose Loop to Next Locator
3. transport loops Chorus until disabled

The loop is converted to native transport frame positions through the song tempo/meter map.

## Recording

MIDI recording must capture:

- note on/off
- velocity
- channel
- CC
- program changes when enabled

Captured events are converted to musical beat positions against the transport clock and stored in MIDI clips.

Audio recording comes after deterministic MIDI recording and plugin hosting. It must use the selected audio input device and latency compensation rather than browser recording APIs.

## Current branch foundation

Implemented in `focus/multitrack-player-core`:

- MIDI input enumeration
- MIDI output enumeration
- live native MIDI capture queue
- MIDI input monitor API
- selectable audio output devices
- engine rebuild/reload path for device changes
- audio / MIDI / software-instrument / pad track model
- plugin instrument/effect state model
- track FX chains
- track groups
- MIDI clips/events model
- locator model
- MIDI-assignable locator triggers
- musical loop-region model
- loop/locator helper tests

## Next native lake

Build the Audio Unit host and connect one real software-instrument track end-to-end:

MIDI input -> MIDI clip/live monitor -> Audio Unit instrument -> track FX -> mixer -> selected audio device.

The acceptance test should be an installed Arturia instrument playing from a connected keyboard, recording MIDI into the arrangement, saving the project, reopening it, and restoring the same instrument state.
