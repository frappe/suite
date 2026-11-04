#!/usr/bin/env bash
# Permit the SFU's explicit 8 MiB UDP buffer request without changing other sockets' defaults.
# Run as root on the Linux host; this does not restart services or resize existing sockets.
set -euo pipefail

target=8388608
current="$(sysctl -n net.core.rmem_max)"
if [[ ! "$current" =~ ^[0-9]+$ ]]; then
    echo "Cannot read a numeric net.core.rmem_max" >&2
    exit 1
fi
if (( current > target )); then
    target="$current"
fi

config="$(mktemp)"
trap 'rm -f "$config"' EXIT
printf '# Meet SFU UDP receive-buffer ceiling; preserve higher host limits.\nnet.core.rmem_max = %s\n' "$target" > "$config"
install -m 0644 "$config" /etc/sysctl.d/60-meet-sfu.conf
sysctl -p /etc/sysctl.d/60-meet-sfu.conf
