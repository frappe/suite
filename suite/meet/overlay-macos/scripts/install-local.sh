#!/bin/bash

set -euo pipefail

overlay_root="$(cd "$(dirname "$0")/.." && pwd)"
source_app="$overlay_root/dist/Suite Meet Overlay.app"
target_root="${INSTALL_ROOT:-/Applications}"
target_app="$target_root/Suite Meet Overlay.app"

"$overlay_root/scripts/build-app.sh"
mkdir -p "$target_root"
rm -rf "$target_app"
ditto "$source_app" "$target_app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$target_app"

printf 'Installed %s\n' "$target_app"
