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
- YouTube remains a reference/playback source. Licensed/local media is used for processing, warping and stem work.

Read [SECRETS.md](./SECRETS.md) before the first release.
