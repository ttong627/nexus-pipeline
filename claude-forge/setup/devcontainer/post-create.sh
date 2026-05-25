#!/bin/bash
set -e

echo "Setting up Claude Code dev environment..."

# Install Claude Code CLI
if ! command -v claude >/dev/null 2>&1; then
    echo "Installing Claude Code..."
    npm install -g @anthropic-ai/claude-code
fi

# Install project dependencies if package.json exists
if [ -f "package.json" ]; then
    echo "Installing project dependencies..."
    npm install
fi

# Install Playwright browsers if playwright is a dependency
if grep -q "playwright" package.json 2>/dev/null; then
    echo "Installing Playwright browsers..."
    npx playwright install --with-deps chromium
fi

echo "Dev environment ready!"
echo "Run 'claude' to start Claude Code"
