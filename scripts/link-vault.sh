#!/usr/bin/env bash
# ==============================================================================
# Symlink SeeLearn plugin directly into an Obsidian DevVault
# Usage: ./scripts/link-vault.sh /path/to/YourVault
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

PLUGINS_DIR="$VAULT_PATH/.obsidian/plugins"
TARGET_DIR="$PLUGINS_DIR/seelearn"
CURRENT_DIR="$(pwd)"

mkdir -p "$PLUGINS_DIR"

if [ -L "$TARGET_DIR" ]; then
  echo "⚠️  Existing symlink found at $TARGET_DIR. Removing..."
  rm "$TARGET_DIR"
elif [ -d "$TARGET_DIR" ]; then
  echo "⚠️  Existing non-symlink directory found at $TARGET_DIR. Backing up to ${TARGET_DIR}.bak..."
  mv "$TARGET_DIR" "${TARGET_DIR}.bak"
fi

ln -s "$CURRENT_DIR" "$TARGET_DIR"
echo "✅ Successfully linked SeeLearn to $TARGET_DIR"
echo "💡 Tip: Install the 'Hot Reload' plugin in Obsidian to automatically reload SeeLearn on every save!"
