#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose=(docker compose -f "$script_dir/docker-compose.yml" -p suite-recorder --env-file "$script_dir/.env")

validate() {
	if [[ ! -f "$script_dir/.env" ]]; then
		echo "Missing $script_dir/.env; copy .env.example and configure it." >&2
		exit 1
	fi

	set -a
	# shellcheck disable=SC1091
	source "$script_dir/.env"
	set +a

	local required=(
		RECORDER_DOMAIN TLS_EMAIL RECORDER_SECRET RECORDER_METRICS_TOKEN
		RECORDER_SITE RECORDER_SITE_ORIGIN SFU_ORIGIN
	)
	local name
	for name in "${required[@]}"; do
		if [[ -z "${!name:-}" || "${!name}" == change-me-* || "${!name}" == *.example.com* ]]; then
			echo "$name must be configured." >&2
			exit 1
		fi
	done

	if (( ${#RECORDER_SECRET} < 32 || ${#RECORDER_METRICS_TOKEN} < 32 )); then
		echo "Recorder secrets must each be at least 32 bytes." >&2
		exit 1
	fi
	if [[ "$RECORDER_DOMAIN" == *://* || "$RECORDER_DOMAIN" == */* ]]; then
		echo "RECORDER_DOMAIN must be a hostname without a scheme or path." >&2
		exit 1
	fi
	if [[ ! "$RECORDER_SITE_ORIGIN" =~ ^https://[^/]+$ || ! "$SFU_ORIGIN" =~ ^https://[^/]+$ ]]; then
		echo "RECORDER_SITE_ORIGIN and SFU_ORIGIN must be exact HTTPS origins." >&2
		exit 1
	fi

	"${compose[@]}" config --quiet
}

case "${1:-help}" in
	setup|start)
		validate
		"${compose[@]}" pull
		"${compose[@]}" up -d
		"${compose[@]}" ps -a
		;;
	stop)
		"${compose[@]}" down
		;;
	update)
		validate
		"${compose[@]}" pull
		"${compose[@]}" up -d --force-recreate
		"${compose[@]}" ps -a
		;;
	status)
		validate
		"${compose[@]}" ps -a
		curl -fsS "https://${RECORDER_DOMAIN}/ready"
		echo
		;;
	logs)
		shift
		"${compose[@]}" logs -f --tail=100 "$@"
		;;
	help|*)
		echo "Usage: ./deploy.sh setup|start|stop|update|status|logs [service]"
		;;
esac
