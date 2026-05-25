#!/bin/bash
set -e

#
# chezmoi Cross-Platform Dotfiles Setup
# Initializes chezmoi with Claude Code config templates
#
# Usage:
#   Mac:   ./setup-chezmoi.sh
#   WSL:   ./setup-chezmoi.sh
#   Linux: ./setup-chezmoi.sh
#

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "chezmoi Dotfiles Setup"
echo "======================"
echo ""

# Install chezmoi
if ! command -v chezmoi >/dev/null 2>&1; then
    echo "Installing chezmoi..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install chezmoi
    else
        sh -c "$(curl -fsLS get.chezmoi.io)"
    fi
    echo -e "${GREEN}chezmoi installed${NC}"
else
    echo -e "${GREEN}chezmoi already installed${NC}"
fi

# Initialize if not already done
if [[ ! -d "$HOME/.local/share/chezmoi" ]]; then
    echo "Initializing chezmoi..."
    chezmoi init
fi

# Copy templates to chezmoi source
CHEZMOI_SRC="$(chezmoi source-path)"
echo "Copying templates to $CHEZMOI_SRC..."

cp "$SCRIPT_DIR/.chezmoi.yaml.tmpl" "$CHEZMOI_SRC/.chezmoi.yaml.tmpl" 2>/dev/null || true
cp -r "$SCRIPT_DIR/dot_claude" "$CHEZMOI_SRC/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/dot_ssh" "$CHEZMOI_SRC/" 2>/dev/null || true

echo -e "${GREEN}Templates copied${NC}"
echo ""
echo "Next steps:"
echo "  1. chezmoi init    (answer prompts for your platform)"
echo "  2. chezmoi diff    (preview changes)"
echo "  3. chezmoi apply   (apply configuration)"
echo ""
echo "To push to a shared repo:"
echo "  cd $(chezmoi source-path)"
echo "  git init && git remote add origin <repo-url>"
echo "  git add -A && git commit -m 'Initial dotfiles'"
echo "  git push -u origin main"
