#!/usr/bin/env bash
# ==============================================================================
# Launch Obsidian with Remote Debugging Port 9222 for Chrome DevTools MCP
# ==============================================================================
set -e

PORT=9222
APP_PATH="/Applications/Obsidian.app/Contents/MacOS/Obsidian"

if [ ! -f "$APP_PATH" ]; then
  echo "❌ Obsidian not found at $APP_PATH"
  exit 1
fi

# Check if port 9222 is already open
if curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "✅ Obsidian is already running with remote debugging on port $PORT."
  exit 0
fi

# Check if Obsidian is running without debug port
PID=$(pgrep -x "Obsidian" || true)
if [ -n "$PID" ]; then
  echo "⚠️  Obsidian is currently running (PID $PID) without remote debugging port."
  echo "🔄 Closing existing Obsidian instance..."
  kill -TERM "$PID" || kill -9 "$PID"
  sleep 1
fi

echo "🚀 Starting Obsidian with --remote-debugging-port=$PORT..."
"$APP_PATH" --remote-debugging-port=$PORT >/dev/null 2>&1 &

# Wait for debug port to become active
for i in {1..10}; do
  if curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "🎉 Obsidian remote debugging is live on port $PORT!"
    echo "🌐 You can now connect via Chrome DevTools MCP: http://127.0.0.1:$PORT"
    exit 0
  fi
  sleep 0.5
done

echo "⚠️  Obsidian launched, but port $PORT is not yet responding. Check Obsidian window."
