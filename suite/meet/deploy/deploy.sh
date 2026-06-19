#!/usr/bin/env bash
# ==============================================================================
# Frappe Meet — Deployment Helper
# ==============================================================================
# Usage:
#   ./deploy.sh setup      — First-time setup: validate, pull, start, create site
#   ./deploy.sh start      — Start all services
#   ./deploy.sh stop       — Stop all services
#   ./deploy.sh restart    — Restart all services
#   ./deploy.sh update     — Pull latest images, migrate, restart
#   ./deploy.sh migrate    — Run bench migrate
#   ./deploy.sh logs       — Tail logs from all services
#   ./deploy.sh status     — Show container status
#   ./deploy.sh backup     — Run bench backup
#   ./deploy.sh shell      — Open a shell in the backend container
#   ./deploy.sh bench      — Run a bench command in the backend container
#   ./deploy.sh ssl-init   — Provision SSL certificates
#   ./deploy.sh ssl-renew  — Force certificate renewal
# ==============================================================================

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"

COMPOSE_PROJECT="frappe-suite"

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
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" "$@"
}

compose_with_ssl() {
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" --profile ssl "$@"
}

# ── Run bench command in backend container ───────────────────────────────────
run_bench() {
    compose exec backend bench "$@"
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
    for var in DOMAIN SSL_EMAIL DB_ROOT_PASSWORD DB_PASSWORD ADMIN_PASSWORD SITE_NAME; do
        if [ -z "${!var:-}" ]; then
            err "$var must be set in .env"
            errors=true
        fi
    done

    if [ -z "${SFU_SECRET:-}" ] || [ "$SFU_SECRET" = "change-me-to-a-strong-random-string" ]; then
        err "SFU_SECRET must be set to a strong random value."
        echo "  Generate one: openssl rand -base64 32"
        errors=true
    fi

    if [ -z "${WEBRTC_ANNOUNCED_IP:-}" ]; then
        err "WEBRTC_ANNOUNCED_IP must be set to your server's public IP."
        echo "  Find it: curl -4 ifconfig.me"
        errors=true
    fi

    if [ "$errors" = true ]; then
        echo ""
        err "Fix the errors above and try again."
        exit 1
    fi

    ok "DOMAIN = $DOMAIN"
    ok "WEBRTC_ANNOUNCED_IP = $WEBRTC_ANNOUNCED_IP"
    ok "SFU served at https://$DOMAIN/sfu/"
    ok "Configuration is valid"
}

# ── Commands ─────────────────────────────────────────────────────────────────
cmd_setup() {
    header "Frappe Meet — Setup"
    check_dependencies
    check_env

    set -a; source "$ENV_FILE"; set +a

    # Pull images
    header "Pulling images"
    docker pull "${FRAPPE_IMAGE:-ghcr.io/frappe/suite/meet:latest}"
    docker pull "${SFU_IMAGE:-ghcr.io/frappe/suite/meet-sfu-server:latest}"
    ok "Images pulled"

    # Start DB + Redis
    header "Starting database & cache"
    compose up -d mariadb redis
    echo "Waiting for MariaDB to be healthy..."
    local retries=30
    while [ $retries -gt 0 ]; do
        if compose exec mariadb mariadb-admin ping -h 127.0.0.1 -u root -p"$DB_ROOT_PASSWORD" &>/dev/null; then
            break
        fi
        retries=$((retries - 1))
        sleep 2
    done
    if [ $retries -eq 0 ]; then
        err "MariaDB failed to start. Check: ./deploy.sh logs mariadb"
        exit 1
    fi
    ok "MariaDB is healthy"
    ok "Redis is ready"

    # Run configurator
    header "Configuring Frappe"
    compose up configurator
    ok "Configuration written"

    # Start Frappe services
    header "Starting Frappe services"
    compose up -d backend frappe-frontend websocket queue-short queue-long scheduler
    sleep 5
    ok "Frappe services started"

    # Create site + install app
    header "Creating Frappe site"
    if run_bench --site "$SITE_NAME" list-apps &>/dev/null 2>&1; then
        info "Site $SITE_NAME already exists, skipping creation."
    else
        run_bench new-site "$SITE_NAME" \
            --db-root-password "$DB_ROOT_PASSWORD" \
            --admin-password "$ADMIN_PASSWORD" \
            --install-app suite \
            --mariadb-user-host-login-scope "%" \
            --set-default
        ok "Site $SITE_NAME created with Meet installed"
    fi

    # Set SFU config on site
    run_bench --site "$SITE_NAME" set-config sfu_server_url "https://$DOMAIN/sfu"
    run_bench --site "$SITE_NAME" set-config sfu_secret "$SFU_SECRET"
    ok "SFU configuration applied"

    # SSL
    header "SSL Certificates"
    if compose_with_ssl run --rm --entrypoint "test -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem" certbot 2>/dev/null; then
        info "SSL certificate already exists. Skipping."
    else
        warn "Provisioning SSL certificates..."
        cmd_ssl_init
    fi

    # Start nginx + SFU
    header "Starting Nginx & SFU"
    compose_with_ssl up -d nginx certbot sfu
    sleep 3
    ok "All services running"

    cmd_status

    echo ""
    header "Setup complete!"
    ok "Meet is live at https://$DOMAIN"
    ok "SFU endpoint: https://$DOMAIN/sfu/"
    info "Login: Administrator / <your ADMIN_PASSWORD>"
    echo ""
}

cmd_start() {
    check_env
    header "Starting services"
    compose_with_ssl up -d
    ok "Services started"
    cmd_status
}

cmd_stop() {
    header "Stopping services"
    compose_with_ssl down
    ok "Services stopped"
}

cmd_restart() {
    header "Restarting services"
    compose_with_ssl restart
    ok "Services restarted"
    cmd_status
}

cmd_update() {
    check_env
    set -a; source "$ENV_FILE"; set +a

    header "Pulling latest images"
    docker pull "${FRAPPE_IMAGE:-ghcr.io/frappe/suite/meet:latest}"
    docker pull "${SFU_IMAGE:-ghcr.io/frappe/suite/meet-sfu-server:latest}"
    ok "Images pulled"

    header "Restarting services with new images"
    compose_with_ssl down
    compose_with_ssl up -d
    sleep 5
    ok "Services restarted"

    header "Running migrations"
    run_bench --site "$SITE_NAME" migrate
    ok "Migrations complete"

    cmd_status
    echo ""
    ok "Update complete"
}

cmd_migrate() {
    set -a; source "$ENV_FILE"; set +a
    header "Running migrations"
    run_bench --site "$SITE_NAME" migrate
    ok "Migrations complete"
}

cmd_logs() {
    compose_with_ssl logs -f --tail=100 "$@"
}

cmd_status() {
    header "Service Status"
    compose_with_ssl ps -a
}

cmd_backup() {
    set -a; source "$ENV_FILE"; set +a
    header "Running backup"
    run_bench --site "$SITE_NAME" backup --with-files
    ok "Backup complete"
    info "Backups stored in the 'sites' Docker volume"
}

cmd_shell() {
    compose exec backend bash
}

cmd_bench() {
    run_bench "$@"
}

cmd_ssl_init() {
    check_dependencies
    bash "$SCRIPT_DIR/nginx/certbot-init.sh"
}

cmd_ssl_renew() {
    header "Renewing SSL certificates"
    compose_with_ssl run --rm --entrypoint certbot certbot renew --force-renewal
    compose restart nginx
    ok "Certificates renewed and nginx restarted"
}

cmd_help() {
    echo ""
    echo -e "${CYAN}Frappe Meet — Deployment Helper${NC}"
    echo ""
    echo "Usage: ./deploy.sh <command>"
    echo ""
    echo "Commands:"
    echo "  setup      First-time setup (validate, pull, start, create site)"
    echo "  start      Start all services"
    echo "  stop       Stop all services"
    echo "  restart    Restart all services"
    echo "  update     Pull latest images, migrate, restart"
    echo "  migrate    Run bench migrate"
    echo "  logs       Tail logs (append service name to filter)"
    echo "  status     Show container status"
    echo "  backup     Run bench backup"
    echo "  shell      Open a shell in the backend container"
    echo "  bench      Run a bench command (e.g., ./deploy.sh bench --site X migrate)"
    echo "  ssl-init   Provision SSL certificates"
    echo "  ssl-renew  Force SSL renewal"
    echo "  help       Show this message"
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────
case "${1:-help}" in
    setup)     cmd_setup ;;
    start)     cmd_start ;;
    stop)      cmd_stop ;;
    restart)   cmd_restart ;;
    update)    cmd_update ;;
    migrate)   cmd_migrate ;;
    logs)      shift; cmd_logs "$@" ;;
    status)    cmd_status ;;
    backup)    cmd_backup ;;
    shell)     cmd_shell ;;
    bench)     shift; cmd_bench "$@" ;;
    ssl-init)  cmd_ssl_init ;;
    ssl-renew) cmd_ssl_renew ;;
    help|*)    cmd_help ;;
esac
