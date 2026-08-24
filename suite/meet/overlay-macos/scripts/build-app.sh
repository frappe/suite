#!/bin/bash

set -euo pipefail

overlay_root="$(cd "$(dirname "$0")/.." && pwd)"
configuration="${CONFIGURATION:-release}"
app_name="Suite Meet Overlay.app"
output_root="${OUTPUT_DIR:-$overlay_root/dist}"
app_path="$output_root/$app_name"

swift build --package-path "$overlay_root" -c "$configuration"
binary_root="$(swift build --package-path "$overlay_root" -c "$configuration" --show-bin-path)"

rm -rf "$app_path"
mkdir -p "$app_path/Contents/MacOS"
cp "$binary_root/SuiteMeetOverlay" "$app_path/Contents/MacOS/SuiteMeetOverlay"
cp "$overlay_root/Resources/Info.plist" "$app_path/Contents/Info.plist"
chmod 755 "$app_path/Contents/MacOS/SuiteMeetOverlay"
plutil -lint "$app_path/Contents/Info.plist"
codesign --force --deep --sign - "$app_path"

printf '%s\n' "$app_path"
