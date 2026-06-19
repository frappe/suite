#!/usr/bin/env bash
# ==============================================================================
# Frappe Meet — Installer
# ==============================================================================
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/frappe/suite/develop/suite/meet/deploy/install.sh | bash
# ==============================================================================

set -euo pipefail

REPO="frappe/suite"
BRANCH="${1:-develop}"
BASE_URL="https://raw.githubusercontent.com/$REPO/$BRANCH/suite/meet/deploy"
INSTALL_DIR="${MEET_INSTALL_DIR:-$PWD/frappe-meet}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${BLUE}[i]${NC} $*"; }
ok()    { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[-]${NC} $*"; exit 1; }

echo -e "${CYAN}"
echo "  Frappe Meet Installer"
echo "  ====================="
echo -e "${NC}"

# Check dependencies
command -v curl &>/dev/null || err "curl is required but not installed."
command -v docker &>/dev/null || err "Docker is required. Install: https://docs.docker.com/engine/install/"
docker compose version &>/dev/null || err "Docker Compose v2 is required."

# Create install directory
info "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR/nginx/templates"
mkdir -p "$INSTALL_DIR/mariadb"

# Download files
FILES=(
    "docker-compose.yml"
    ".env.example"
    "deploy.sh"
    "mariadb/my.cnf"
    "nginx/certbot-init.sh"
    "nginx/templates/default.conf.template"
)

for file in "${FILES[@]}"; do
    info "Downloading $file..."
    curl -fsSL "$BASE_URL/$file" -o "$INSTALL_DIR/$file"
done

# Make scripts executable
chmod +x "$INSTALL_DIR/deploy.sh"
chmod +x "$INSTALL_DIR/nginx/certbot-init.sh"

# Create .env from template if it doesn't exist
if [ ! -f "$INSTALL_DIR/.env" ]; then
    cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
    ok "Created .env from template"
else
    warn ".env already exists, not overwriting"
fi

echo ""
ok "Installation complete!"
echo ""
info "Next steps:"
echo ""
echo "  1. Edit the configuration:"
echo "     nano $INSTALL_DIR/.env"
echo ""
echo "  2. Set these required values:"
echo "     - DOMAIN"
echo "     - SSL_EMAIL"
echo "     - DB_ROOT_PASSWORD"
echo "     - DB_PASSWORD"
echo "     - ADMIN_PASSWORD"
echo "     - SFU_SECRET          (generate: openssl rand -base64 32)"
echo "     - WEBRTC_ANNOUNCED_IP (find: curl -4 ifconfig.me)"
echo ""
echo "  3. Run setup:"
echo "     cd $INSTALL_DIR && ./deploy.sh setup"
echo ""
