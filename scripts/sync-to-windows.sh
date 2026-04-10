#!/usr/bin/env bash
set -euo pipefail

SRC="/home/sc7639/code/src/vibeyard/"
DEST="/mnt/c/Users/scrot/vibeyard/"

EXCLUDES=(
  node_modules
  dist
  out
  .git
  coverage
  .DS_Store
  '*.tsbuildinfo'
  '*.log'
  squashfs-root
)

EXCLUDE_ARGS=()
for e in "${EXCLUDES[@]}"; do
  EXCLUDE_ARGS+=(--exclude "$e")
done

if ! command -v inotifywait &>/dev/null; then
  echo "inotifywait not found. Install it with:"
  echo "  sudo apt-get install inotify-tools"
  exit 1
fi

do_sync() {
  echo "[$(date +%H:%M:%S)] Syncing..."
  rsync -av --delete "${EXCLUDE_ARGS[@]}" "$SRC" "$DEST"
  echo "[$(date +%H:%M:%S)] Done."
}

# Initial sync
do_sync

echo "Watching for changes in $SRC ..."

inotifywait -mrq -e modify,create,delete,move "$SRC" \
  --exclude '(node_modules|dist|out|\.git|coverage|squashfs-root)' |
while read -r _dir _event _file; do
  do_sync
done
