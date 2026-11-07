#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
# Optional read-only extracted Linux runtime; no system package/service changes.
if [[ -z "${MEET_AUDIO_DEPS:-}" ]]; then
  MEET_BROWSER=firefox node e2e/meet/silent-media/run.mjs
  exit
fi
runtime="$PWD/e2e/meet/silent-media/.runtime"
mkdir -p "$runtime"
chmod 700 "$runtime"
lib="$MEET_AUDIO_DEPS/pulse-deps/root/usr/lib"
export LD_LIBRARY_PATH="$lib/x86_64-linux-gnu:$lib/x86_64-linux-gnu/pulseaudio:$lib/pulse-17.0+dfsg1/modules:$MEET_AUDIO_DEPS/firefox-deps/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export XDG_RUNTIME_DIR="$runtime"
export XDG_CONFIG_HOME="$runtime/config"
export PULSE_SERVER="unix:$runtime/audio.sock"
[[ ! -e "$runtime/audio.sock" ]]
"$MEET_AUDIO_DEPS/pulse-deps/root/usr/bin/pulseaudio" --daemonize=no --exit-idle-time=-1 --use-pid-file=no --dl-search-path="$lib/pulse-17.0+dfsg1/modules" -n --load="module-native-protocol-unix socket=$runtime/audio.sock auth-anonymous=1" --load="module-null-sink sink_name=meet_silent_media" > "$runtime/pulse.log" 2>&1 &
pulse_pid=$!
trap 'kill "$pulse_pid" 2>/dev/null || true; wait "$pulse_pid" 2>/dev/null || true; rm -f "$runtime/audio.sock"' EXIT
for ((i=0;i<50;i++)); do [[ ! -S "$runtime/audio.sock" ]] || break; sleep .1; done
[[ -S "$runtime/audio.sock" ]]
MEET_BROWSER=firefox node e2e/meet/silent-media/run.mjs
