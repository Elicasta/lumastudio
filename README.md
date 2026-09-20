# LumaRig Studio

LumaRig Studio is a performance-first multitrack, MIDI, video, pad and lighting control environment built around one model:

**Setlist → Song Arrangement → Performance**

Every Setlist row is a Song. Every Song owns an Arrangement. Sections/Locators drive audio position, click, guide, MIDI, video and lighting from the same musical timeline.

## Current foundation

- Tauri 2 desktop shell
- React + TypeScript interface
- Setlist screen
- Add Song wizard
- Analyze → Stem Split → Map Sections → Review flow
- Song Arrangement timeline
- Performance screen
- 12-pad player
- Mixer
- Lighting workspace
- MIDI / video / source workspace shells
- Connections screen
- Studio-owned Supabase remote pairing + Realtime relay
- dedicated next-Song performance control
- updater settings
- GitHub CI
- universal macOS DMG release workflow
- signed Tauri updater configuration

See [BUILD_PLAN.md](./BUILD_PLAN.md) for the implementation sequence and [SECRETS.md](./SECRETS.md) for release credentials.

## Development

```bash
npm install
npm run tauri:dev
```

Frontend only:

```bash
npm run dev
```

Tests:

```bash
npm test
npm run build
```

Local macOS DMG:

```bash
npm run dmg
```

## Architecture rules

- The audio grid is not the database.
- Song → Arrangement → Section is the source of truth.
- Section events share one musical clock.
- Realtime audio work stays isolated from AI, disk, network and UI work.
- Stem separation runs as a worker job and maps aligned stems into track columns.
- The Mac app owns remote sessions and canonical show state. Companion remotes only join sessions created by Studio.
- Supabase handles remote session discovery and low-latency relay; it never becomes the playback clock or audio source of truth.
- YouTube remains a reference/playback source. Licensed/local media is used for processing, warping and stem work.

Read [SECRETS.md](./SECRETS.md) before the first release.


## Automatic Sections and Count-In

Normal playback follows the mapped Song Arrangement automatically. Operators do not need to press Verse, Chorus, Bridge, or other Section buttons during a normal run.

Manual Section controls are overrides:

- tapping a Section or GO while playing calculates the current musical bar/beat
- the current audio keeps playing during the preparation window
- Adaptive Count starts on a clean beat and lands the requested Section on beat 1
- if the target Section changes tempo or meter, the count establishes the destination pulse
- per-Song start count-in supports Off, bars, fixed beats, and custom beat counts
- per-Section manual-jump count-in can inherit the Song setting or override it
- no-count jumps remain beat-quantized rather than cutting at a random sample
- detected downbeat offset anchors the musical grid without trimming source media

Count-in clicks are currently generated inside the native audio engine. The reusable spoken Guide vocabulary, phrase planner, voice-pack validator, and recording contract are now defined. Dedicated native Guide-bus sample playback/output routing is the next audio step.

See [Guide Voice System](./docs/GUIDE_VOICE_SYSTEM.md) and [Voice Pack Recording Script](./docs/VOICE_PACK_RECORDING_SCRIPT.md).

