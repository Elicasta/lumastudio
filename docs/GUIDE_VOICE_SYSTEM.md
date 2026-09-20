# LumaRig Guide Voice System

## Goal

Record a small vocabulary once and reuse it across every Song, Setlist, automatic Section transition, Song start, and manual Section jump.

LumaRig must not require a prerecorded phrase such as chorus-2-3-4.wav. It assembles that cue from atomic tokens:

~~~text
section.chorus + count.2 + count.3 + count.4
~~~

That keeps voice packs small, replaceable, localizable, and consistent.

## Core behavior

### Normal playback

Mapped Sections advance automatically from the Song timeline. One count bar before the next mapped Section, the Guide bus can announce the destination:

~~~text
4/4  Chorus · 2 · 3 · 4 → CHORUS beat 1
3/4  Verse  · 2 · 3     → VERSE beat 1
5/4  Bridge · 2 · 3 · 4 · 5 → BRIDGE beat 1
~~~

No operator input is required.

### Song start

The Song count-in determines the pre-roll length. By default only the final pre-roll bar is spoken, even when there are two or more count bars. Earlier bars remain click-only.

~~~text
bar -2: click · click · click · click
bar -1: Intro · 2 · 3 · 4
bar  1: SONG
~~~

### Manual Section jump

The transport calculates the available musical preparation time. If two pulses remain in a 4/4 bar before the destination can safely land:

~~~text
beat 3: Chorus
beat 4: 4
next 1: CHORUS
~~~

If a full bar is available, LumaRig uses Chorus · 2 · 3 · 4. If more than one bar is required, the final bar is voiced and earlier bars use click only. If the destination changes tempo or meter, the count establishes the destination pulse before the jump.

## Voice output modes

- off
- click-only
- voice-and-click — default
- voice-only

Click and Guide are separate logical buses. They must eventually be independently routable to audio outputs, even if both initially use the same hardware device.

## Initial bundled voices

Ship two core English packs first:

- core-en-neutral-f — neutral female voice
- core-en-neutral-m — neutral male voice

Voice identity is represented only by a pack ID. Additional voices, user-recorded packs, and other languages can use the same manifest contract.

## Required core vocabulary

A complete core voice pack contains 44 recordings.

### Counts — 16

One through Sixteen, stored as count.1.wav through count.16.wav.

Counts are beat numbers within a bar, not a running total across an entire multi-bar pre-roll.

### Section names — 17

Intro, Verse, Pre-Chorus, Chorus, Refrain, Bridge, Tag, Vamp, Turnaround, Instrumental, Interlude, Breakdown, Build, Drop, Solo, Outro, Ending.

Repeated arrangement labels reuse the same token: Verse 1 and Verse 2 both use section.verse; Chorus 3 uses section.chorus. The ordinal remains visible in the UI but does not require another recording.

### Direction cues — 11

Hold, Stop, Repeat, Again, Last Time, One More, Two More, Build, Down, Big, Soft.

These are reusable timeline Guide events and are not tied to a Section type.

## Optional extended vocabulary

Ready, Go, And, E, A, Trip, Let, Half Time, Double Time, Key Change, Modulation, All In, Band In, Drums In, Vocals In, Cut, Ring Out.

Subdivision words should only be added if the performance engine actually uses spoken subdivisions. The core count-in should stay uncluttered.

## Meter and pulse feel

The first implementation speaks notated meter pulses:

~~~text
2/4 → Section · 2
3/4 → Section · 2 · 3
4/4 → Section · 2 · 3 · 4
5/4 → Section · 2 · 3 · 4 · 5
6/8 → Section · 2 · 3 · 4 · 5 · 6
7/8 → Section · 2 · 3 · 4 · 5 · 6 · 7
~~~

A future compound-pulse option can use the same voice assets:

~~~text
6/8 felt in 2  → Section · 2
9/8 felt in 3  → Section · 2 · 3
12/8 felt in 4 → Section · 2 · 3 · 4
~~~

That is a timing choice, not a different recording pack.

## Recording specification

Record each token as an independent dry one-shot:

- WAV, 48 kHz, 24-bit PCM, mono
- no reverb or room effect
- no baked-in music or click
- consistent microphone, distance, tone, and gain
- tight edit with no audible breath before the word
- retain a natural short tail; do not hard-gate consonants
- peak safely below clipping; the engine applies final Guide-bus gain

The delivery should be short, clear, and neutral rather than conversational. Counts should have very consistent timing and emphasis.

Preferred folder layout:

~~~text
voice-packs/
  core-en-neutral-f/
    manifest.json
    count.1.wav
    ...
    section.chorus.wav
    ...
    direction.last-time.wav
~~~

## Timing metadata

A manifest asset may include onsetMs for measured acoustic onset and gainDb for per-token trim correction. The scheduler owns musical timing. The WAV never owns tempo.

## Phrase assembly rules

Standard one-bar Section cue:

~~~text
slot 1 = Section token
slot 2..N = count.2 .. count.N
~~~

For an unknown custom Section, keep its custom label in the UI, do not invent or mispronounce it, use numbers-only Guide count, and later allow the user to record a custom token or assign a spoken alias.

## Routing contract

The native engine now exposes separate MUSIC, CLICK, GUIDE, and MASTER stages. MUSIC, CLICK, and GUIDE each have an independent hardware output pair on the active audio device. Imported Click/Guide stems and generated count/voice cues converge on those same buses.

A normal live configuration can route Music to outputs 1–2 and Click + Guide to a separate IEM pair such as outputs 3–4, while the Master stage remains the global safety gain/mute. Voice events are scheduled by the native audio clock, never React timers or the remote.

## Voice pack validation

Before a pack becomes selectable, validate manifest version, locale, required core tokens, referenced files, decodability, sample-rate/channel conversion, duplicate tokens, and timing/gain metadata. Missing optional tokens should not invalidate the pack.

## Reuse model

~~~text
Voice Pack
   ↓
Token Library
   ↓
Guide Cue Planner
   ↓
Musical pulse schedule
   ↓
Native Guide Bus
   ↓
Audio output routing
~~~

Songs store preferences and Section labels. They do not store rendered voice phrases. This is what allows one recorded pack to work indefinitely.


## Development voice pack

For end-to-end testing on macOS:

```bash
npm run voice:dev
```

This uses the local macOS `say` and `afconvert` utilities to create all 44 required WAV tokens at 48 kHz/24-bit mono under `voice-packs/generated/`. The generated system-voice pack is a development convenience, not the final bundled production voice.


## Implemented direction markers

The Arrangement inspector can attach one reusable spoken direction cue to the
start of a Section. Current core choices are:

- Last Time
- One More
- Two More
- Hold
- Stop
- Repeat
- Again
- Build
- Down
- Big
- Soft

These are stored as Song `guideMarkers` with bar/beat positions and token IDs.
They are converted to absolute native Guide events when the Song's Guide timeline
is prepared. A custom recorded token such as `custom.everybody-in` uses the same
marker model.

## Musical count position

The native transition scheduler now knows both total count pulses and
`pulsesPerBar`. That means:

- a two-bar 4/4 count accents beat 1 of both bars
- a short adaptive 4/4 jump can correctly count beats 3, 4 instead of relabeling
  the first available pulse as beat 1
- compound 6/8 can count 1, 2 when the Song uses compound feel
- the performance UI can display beat-in-bar and count-bar position separately

The voice planner and click generator share this pulse model so spoken numbers,
click accents, and the destination downbeat stay consistent.
