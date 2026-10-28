#!/usr/bin/env bash
# ==============================================================================
# Setup DevVault for SeeLearn: Symlink plugin + install Hot Reload
# Usage: ./scripts/setup-dev-vault.sh /path/to/YourVault
# ==============================================================================
set -e

VAULT_PATH="$1"

if [ -z "$VAULT_PATH" ]; then
  echo "Usage: $0 /path/to/YourObsidianVault"
  exit 1
fi

if [ ! -d "$VAULT_PATH" ]; then
  echo "❌ Error: Vault directory does not exist: $VAULT_PATH"
  exit 1
fi

OBSIDIAN_DIR="$VAULT_PATH/.obsidian"
PLUGINS_DIR="$OBSIDIAN_DIR/plugins"
SEELEARN_DIR="$PLUGINS_DIR/seelearn"
HOT_RELOAD_DIR="$PLUGINS_DIR/hot-reload"
CURRENT_DIR="$(pwd)"

mkdir -p "$PLUGINS_DIR"

# 1. Symlink SeeLearn
if [ -L "$SEELEARN_DIR" ]; then
  echo "ℹ️  Existing SeeLearn symlink found. Re-linking..."
  rm "$SEELEARN_DIR"
elif [ -d "$SEELEARN_DIR" ]; then
  echo "⚠️  Existing non-symlink SeeLearn found. Backing up to ${SEELEARN_DIR}.bak..."
  mv "$SEELEARN_DIR" "${SEELEARN_DIR}.bak"
fi
ln -s "$CURRENT_DIR" "$SEELEARN_DIR"
echo "✅ Linked SeeLearn plugin to $SEELEARN_DIR"

# 2. Install Hot Reload plugin if missing
if [ ! -d "$HOT_RELOAD_DIR" ]; then
  echo "📦 Installing obsidian-hot-reload plugin for sub-second reloads..."
  mkdir -p "$HOT_RELOAD_DIR"
  curl -sL https://github.com/pjeby/hot-reload/releases/latest/download/main.js -o "$HOT_RELOAD_DIR/main.js"
  curl -sL https://github.com/pjeby/hot-reload/releases/latest/download/manifest.json -o "$HOT_RELOAD_DIR/manifest.json"
  echo "✅ Hot Reload plugin installed at $HOT_RELOAD_DIR"
else
  echo "✅ Hot Reload plugin is already present."
fi

# 3. Enable plugins in community-plugins.json
COMMUNITY_PLUGINS="$OBSIDIAN_DIR/community-plugins.json"
if [ ! -f "$COMMUNITY_PLUGINS" ]; then
  echo '["seelearn", "hot-reload"]' > "$COMMUNITY_PLUGINS"
else
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    let plugins = [];
    try { plugins = JSON.parse(fs.readFileSync(file, "utf8")); } catch(e) {}
    if (!plugins.includes("seelearn")) plugins.push("seelearn");
    if (!plugins.includes("hot-reload")) plugins.push("hot-reload");
    fs.writeFileSync(file, JSON.stringify(plugins, null, 2) + "\n");
  ' "$COMMUNITY_PLUGINS"
fi
echo "✅ Enabled 'seelearn' and 'hot-reload' in community-plugins.json"

# 4. Copy test fixtures into the Vault for immediate testing
FIXTURES_VAULT_DIR="$VAULT_PATH/SeeLearn Fixtures"
mkdir -p "$FIXTURES_VAULT_DIR"
cp "$CURRENT_DIR/tests/fixtures/"*.md "$FIXTURES_VAULT_DIR/"
echo "✅ Copied test markdown fixtures to '$FIXTURES_VAULT_DIR'"

echo ""
echo "🎉 DevVault setup complete!"
echo "👉 Run 'npm run dev:obsidian' to launch Obsidian with remote debugging port 9222."
echo "👉 Run 'npm run dev' to start esbuild auto-rebuild on file changes."
