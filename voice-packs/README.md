# Voice Packs

Voice packs are reusable atomic Guide vocabularies. Runtime packs should follow the manifest contract in `src/domain/guideVoice.ts`.

The `core-en-template` directory is a recording/import template only; it intentionally does not contain WAV files.

To create a pack:

1. Copy `core-en-template` to a new pack ID.
2. Record/export the 44 WAV files from `docs/VOICE_PACK_RECORDING_SCRIPT.md`.
3. Keep the manifest token names stable.
4. Set the performer/voice label and pack ID.
5. Measure per-token `onsetMs` only when compensation is needed.
6. Validate the pack before making it selectable in Studio.

Recommended first production IDs:

- `core-en-neutral-f`
- `core-en-neutral-m`

Do not commit licensed third-party voice samples unless redistribution rights explicitly allow bundling them with the app.
