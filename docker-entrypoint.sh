#!/bin/sh
set -e

REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"
APP_DIR="/app/repo"
DATA_DIR="${DATA_DIR:-/data}"

mkdir -p "$DATA_DIR"
export DATA_DIR="$DATA_DIR"

if [ -n "$REPO_URL" ]; then
  echo "[Docker Entrypoint] Checking repository from $REPO_URL (branch: $BRANCH)..."

  # Support credentials in environment if provided separately
  TARGET_URL="$REPO_URL"
  if [ -n "$GITEA_TOKEN" ]; then
    # Inject token into http(s) URL if not already present
    PROTO=$(echo "$REPO_URL" | sed -E 's/^(https?:\/\/).*/\1/')
    REST=$(echo "$REPO_URL" | sed -E 's/^https?:\/\///')
    TARGET_URL="${PROTO}${GITEA_TOKEN}@${REST}"
  elif [ -n "$GITEA_USER" ] && [ -n "$GITEA_PASSWORD" ]; then
    PROTO=$(echo "$REPO_URL" | sed -E 's/^(https?:\/\/).*/\1/')
    REST=$(echo "$REPO_URL" | sed -E 's/^https?:\/\///')
    TARGET_URL="${PROTO}${GITEA_USER}:${GITEA_PASSWORD}@${REST}"
  fi

  if [ ! -d "$APP_DIR/.git" ]; then
    echo "[Docker Entrypoint] Cloning fresh repository into $APP_DIR..."
    git clone --branch "$BRANCH" "$TARGET_URL" "$APP_DIR"
  else
    echo "[Docker Entrypoint] Existing repository found. Pulling latest updates..."
    cd "$APP_DIR"
    git remote set-url origin "$TARGET_URL"
    git fetch origin "$BRANCH"
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
  fi

  cd "$APP_DIR"
  echo "[Docker Entrypoint] Installing/updating dependencies..."
  npm install --omit=dev --no-audit --no-fund
else
  echo "[Docker Entrypoint] No REPO_URL provided. Running from baked-in source code in /app/repo..."
  cd "$APP_DIR"
fi

echo "[Docker Entrypoint] Starting Poker Tournament Manager..."
exec node server.js
