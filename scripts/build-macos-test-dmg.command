#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo ""
echo "LumaRig Studio local macOS test build"
echo "===================================="
echo ""

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: This script must run on macOS."
  exit 1
fi

for cmd in node npm cargo rustc xcodebuild; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: Missing required command: $cmd"
    echo ""
    echo "This Mac needs Node.js, Rust and Xcode Command Line Tools before LumaRig Studio can be built."
    exit 1
  fi
done

echo "Node:  $(node --version)"
echo "npm:   $(npm --version)"
echo "Rust:  $(rustc --version)"
echo ""

echo "[1/6] Installing dependencies..."
npm install

echo "[2/6] Checking synchronized versions..."
npm run check:versions

echo "[3/6] Running frontend tests..."
npm test

echo "[4/6] Building frontend..."
npm run build

echo "[5/6] Running native Rust tests..."
cargo test --manifest-path src-tauri/Cargo.toml

echo "[6/6] Building macOS DMG..."
npm run dmg

DMG="$(find "$ROOT/src-tauri/target/release/bundle/dmg" -maxdepth 1 -name '*.dmg' -print -quit)"

if [[ -z "$DMG" || ! -f "$DMG" ]]; then
  echo "ERROR: Build finished but no DMG was found."
  exit 1
fi

DEST="$HOME/Desktop/LumaRig-Studio-Test.dmg"
cp "$DMG" "$DEST"

echo ""
echo "SUCCESS"
echo "DMG copied to:"
echo "$DEST"
echo ""

open -R "$DEST"
