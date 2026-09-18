#!/bin/sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
MONGODB_URI="${MONGODB_URI:-mongodb://mongodb:27017/ielts_db}"
BACKUP_INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

while true; do
  stamp="$(date +%Y%m%d-%H%M%S)"
  target="$BACKUP_DIR/ielts-$stamp.archive.gz"

  if mongodump --uri="$MONGODB_URI" --archive="$target" --gzip; then
    echo "[mongo-backup] Đã tạo bản backup: $target"
  else
    echo "[mongo-backup] Backup thất bại cho $MONGODB_URI" >&2
  fi

  find "$BACKUP_DIR" -type f -name 'ielts-*.archive.gz' -mtime "+$BACKUP_RETENTION_DAYS" -delete

  sleep "$BACKUP_INTERVAL_SECONDS"
done
