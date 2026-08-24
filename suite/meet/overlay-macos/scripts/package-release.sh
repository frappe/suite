#!/bin/bash

set -euo pipefail

overlay_root="$(cd "$(dirname "$0")/.." && pwd)"
version="${1:-0.1.0}"
output_root="$overlay_root/dist"
archive="$output_root/SuiteMeetOverlay-$version-macos.zip"
cask="$output_root/suite-meet-overlay.rb"

"$overlay_root/scripts/build-app.sh"
rm -f "$archive"
ditto -c -k --sequesterRsrc --keepParent "$output_root/Suite Meet Overlay.app" "$archive"
checksum="$(shasum -a 256 "$archive" | awk '{print $1}')"
sed \
	-e "s/__VERSION__/$version/g" \
	-e "s/__SHA256__/$checksum/g" \
	"$overlay_root/homebrew/suite-meet-overlay.rb.template" > "$cask"

printf 'Archive: %s\nCask: %s\nSHA-256: %s\n' "$archive" "$cask" "$checksum"
