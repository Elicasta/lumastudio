# Release keys and GitHub secrets

Normal development builds need no secrets.

The release / auto-update pipeline uses two trust systems:

1. **Tauri updater signing** proves an update was created by us.
2. **Apple code signing + notarization** makes the downloaded macOS app trusted by Gatekeeper.

## Required before the first updateable release

### Tauri updater signing key

Generate this once on a trusted Mac:

```bash
npm install
npm run tauri signer generate -- -w ~/.tauri/lumarig-studio.key
```

Back up the private key. Losing it means installed copies cannot trust future updates.

Add these GitHub repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The signer also produces a public key. The public key is safe to commit.

Replace this placeholder in `src-tauri/tauri.conf.json`:

```text
__TAURI_UPDATER_PUBLIC_KEY__
```

with the complete public key content.

## Apple Developer ID secrets

For a distributable, notarized DMG add:

- `APPLE_CERTIFICATE` — base64-encoded Developer ID Application certificate (.p12)
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD` — Apple app-specific password
- `APPLE_TEAM_ID`

Until those are set, `tauri.conf.json` uses ad-hoc signing (`signingIdentity: "-"`) for local/test macOS builds.

## Provided automatically by GitHub Actions

Do not create this manually:

- `GITHUB_TOKEN`

## Release flow

1. Update the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Merge to `main`.
3. Push tag `vX.Y.Z`.
4. GitHub Actions builds a universal macOS app, DMG and updater artifacts.
5. Review the draft prerelease.
6. Publish it.
7. Installed clients check `releases/latest/download/latest.json`.

The updater endpoint is already configured for `Elicasta/lumastudio`.
