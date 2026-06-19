#!/usr/bin/env bash
# ==============================================================================
# Frappe Meet SFU — Deployment Helper
# ==============================================================================
# Usage:
#   ./deploy.sh setup      — Validate config, pull image, provision SSL, start
#   ./deploy.sh start      — Start all services
#   ./deploy.sh stop       — Stop all services
#   ./deploy.sh restart    — Restart all services
#   ./deploy.sh pull       — Pull the latest SFU image
#   ./deploy.sh logs       — Tail logs from all services
#   ./deploy.sh status     — Show container status and health
#   ./deploy.sh ssl-init   — Provision SSL certificate (first time only)
#   ./deploy.sh ssl-renew  — Force certificate renewal
# ==============================================================================

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"

# ── Project name ──────────────────────────────────────────────────────────────
# Use a fixed project name so Docker volume names are predictable regardless of
# the directory the stack is installed into (e.g., /opt/meet-sfu vs ./deploy).
COMPOSE_PROJECT="suite-sfu"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${BLUE}[i]${NC} $*"; }
ok()    { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[-]${NC} $*"; }
header(){ echo -e "\n${CYAN}--- $* ---${NC}\n"; }

# ── Compose wrapper ──────────────────────────────────────────────────────────
compose() {
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" --profile ssl "$@"
}

# ── Preflight checks ────────────────────────────────────────────────────────
check_dependencies() {
    header "Checking dependencies"

    local missing=false

    if ! command -v docker &>/dev/null; then
        err "Docker is not installed. See https://docs.docker.com/engine/install/"
        missing=true
    else
        ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
    fi

    if ! docker compose version &>/dev/null; then
        err "Docker Compose v2 is not installed."
        missing=true
    else
        ok "Docker Compose $(docker compose version --short)"
    fi

    if [ "$missing" = true ]; then
        exit 1
    fi
}

check_env() {
    header "Validating configuration"

    if [ ! -f "$ENV_FILE" ]; then
        err ".env file not found."
        echo "  Run: cp .env.example .env && nano .env"
        exit 1
    fi

    set -a
    source "$ENV_FILE"
    set +a

    local errors=false

    # Required fields
    if [ -z "${JWT_SECRET:-}" ] || [ "$JWT_SECRET" = "change-me-to-a-strong-random-string" ]; then
        err "JWT_SECRET must be set to a strong random value."
        echo "  Generate one: openssl rand -base64 32"
        errors=true
    else
        ok "JWT_SECRET is set"
    fi

    if [ -z "${WEBRTC_ANNOUNCED_IP:-}" ]; then
        err "WEBRTC_ANNOUNCED_IP must be set to your server's public IP."
        echo "  Find it: curl -4 ifconfig.me"
        errors=true
    else
        ok "WEBRTC_ANNOUNCED_IP = $WEBRTC_ANNOUNCED_IP"
    fi

    if [ -z "${DOMAIN:-}" ]; then
        err "DOMAIN must be set (e.g., sfu.meet.example.com)."
        errors=true
    else
        ok "DOMAIN = $DOMAIN"
    fi

    if [ -z "${SSL_EMAIL:-}" ]; then
        err "SSL_EMAIL must be set for Let's Encrypt certificate provisioning."
        errors=true
    fi

    # Informational
    info "SFU Image: ${SFU_IMAGE:-ghcr.io/frappe/suite/meet-sfu-server:latest}"
    info "SFU Port: ${PORT:-3000}"
    info "WebRTC ports: ${RTC_MIN_PORT:-40000}-${RTC_MAX_PORT:-40200} UDP"

    if [ "$errors" = true ]; then
        echo ""
        err "Fix the errors above and try again."
        exit 1
    fi

    ok "Configuration is valid"
}

# ── Commands ─────────────────────────────────────────────────────────────────
cmd_setup() {
    header "Frappe Meet SFU — Setup"
    check_dependencies
    check_env

    header "Pulling SFU image"
    set -a; source "$ENV_FILE"; set +a
    docker pull "${SFU_IMAGE:-ghcr.io/frappe/suite/meet-sfu-server:latest}"
    ok "Image pulled"

    # Start SFU first (nginx depends on it being healthy)
    header "Starting SFU"
    compose up -d sfu
    ok "SFU container started"

    header "SSL Certificate"
    # Check if certs already exist inside the Docker volume
    if docker run --rm -v "${COMPOSE_PROJECT}_certbot-certs:/certs" alpine \
        test -f "/certs/live/${DOMAIN:-}/fullchain.pem" 2>/dev/null; then
        info "SSL certificate already exists. Skipping provisioning."
        info "To re-provision, run: ./deploy.sh ssl-init"
    else
        warn "No SSL certificate found. Provisioning now..."
        cmd_ssl_init
    fi

    header "Starting all services"
    compose up -d
    sleep 3
    cmd_status

    echo ""
    header "Setup complete!"
    set -a; source "$ENV_FILE"; set +a
    ok "SFU is running at https://$DOMAIN"
    echo ""
    info "Next step: Add this to your Frappe site_config.json:"
    echo ""
    echo "  {"
    echo "    \"sfu_server_url\": \"https://$DOMAIN\","
    echo "    \"sfu_secret\": \"<your JWT_SECRET from .env>\""
    echo "  }"
    echo ""
}

cmd_start() {
    check_env
    header "Starting services"
    compose up -d
    ok "Services started"
    cmd_status
}

cmd_stop() {
    header "Stopping services"
    compose down
    ok "Services stopped"
}

cmd_restart() {
    header "Restarting services"
    compose restart
    ok "Services restarted"
    cmd_status
}

cmd_pull() {
    set -a; source "$ENV_FILE"; set +a
    header "Pulling latest SFU image"
    docker pull "${SFU_IMAGE:-ghcr.io/frappe/suite/meet-sfu-server:latest}"
    ok "Image pulled"
    info "Run './deploy.sh restart' to use the new image"
}

cmd_update() {
    header "Updating SFU"
    cmd_pull
    header "Recreating SFU container"
    compose up -d --force-recreate sfu
    ok "SFU updated"
    cmd_status
}

cmd_logs() {
    compose logs -f --tail=100 "$@"
}

cmd_status() {
    header "Service Status"
    compose ps -a
    echo ""

    set -a; source "$ENV_FILE"; set +a
    local health_url="https://${DOMAIN}/health"

    info "Health check: $health_url"
    if curl -fsS "$health_url" 2>/dev/null | python3 -m json.tool 2>/dev/null; then
        ok "SFU is healthy"
    else
        # Try direct port (may work if nginx is still starting)
        if curl -fsS "http://127.0.0.1:${PORT:-3000}/health" 2>/dev/null | python3 -m json.tool 2>/dev/null; then
            ok "SFU is healthy (direct port)"
        else
            warn "Health check failed — SFU may still be starting"
        fi
    fi
}

cmd_ssl_init() {
    check_dependencies
    set -a; source "$ENV_FILE"; set +a
    bash "$SCRIPT_DIR/nginx/certbot-init.sh"
}

cmd_ssl_renew() {
    header "Renewing SSL certificate"
    compose run --rm --entrypoint certbot certbot renew --force-renewal
    compose restart nginx
    ok "Certificate renewed and nginx restarted"
}

cmd_help() {
    echo ""
    echo -e "${CYAN}Frappe Meet SFU — Deployment Helper${NC}"
    echo ""
    echo "Usage: ./deploy.sh <command>"
    echo ""
    echo "Commands:"
    echo "  setup      Validate config, pull image, provision SSL, start everything"
    echo "  start      Start all services"
    echo "  stop       Stop all services"
    echo "  restart    Restart all services"
    echo "  pull       Pull the latest SFU image from the registry"
    echo "  update     Pull latest image and recreate the SFU container"
    echo "  logs       Tail logs (append service name to filter, e.g., logs sfu)"
    echo "  status     Show container status and health"
    echo "  ssl-init   Provision SSL certificate (first time)"
    echo "  ssl-renew  Force SSL certificate renewal"
    echo "  help       Show this message"
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────
case "${1:-help}" in
    setup)     cmd_setup ;;
    start)     cmd_start ;;
    stop)      cmd_stop ;;
    restart)   cmd_restart ;;
    pull)      cmd_pull ;;
    update)    cmd_update ;;
    logs)      shift; cmd_logs "$@" ;;
    status)    cmd_status ;;
    ssl-init)  cmd_ssl_init ;;
    ssl-renew) cmd_ssl_renew ;;
    help|*)    cmd_help ;;
esac
