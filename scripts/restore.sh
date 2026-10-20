#!/bin/sh
# HALQA Database Restore Script
#
# Restores a compressed MySQL dump created by backup.sh.
#
# Usage (Docker):
#   docker exec halqa-backup sh /backup/restore.sh halqa_20260803_230000.sql.gz
#
# Usage (local):
#   MYSQL_HOST=localhost MYSQL_USER=root MYSQL_PASSWORD= \
#     MYSQL_DATABASE=halqa_db sh scripts/restore.sh halqa_20260803_230000.sql.gz
#
# The script:
#   1. Verifies the backup file exists and passes gzip integrity check
#   2. Prompts for confirmation (unless RESTORE_NO_CONFIRM=1)
#   3. Drops and recreates the target database
#   4. Streams the gzipped dump directly into mysql
#   5. Verifies the restore by counting tables

set -e

MYSQL_HOST="${MYSQL_HOST:-mysql}"
MYSQL_DATABASE="${MYSQL_DATABASE:-halqa_db}"
BACKUP_FILE="$1"

# ─── Argument check ───────────────────────────────────────────────────────────
if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: sh restore.sh <backup_file.sql.gz>"
  echo ""
  echo "Available backups:"
  ls -lh /backups/halqa_*.sql.gz 2>/dev/null || ls -lh ./backups/halqa_*.sql.gz 2>/dev/null || echo "  (no backups found in /backups or ./backups)"
  exit 1
fi

# Support relative paths from /backups/ directory
if [ ! -f "$BACKUP_FILE" ] && [ -f "/backups/$BACKUP_FILE" ]; then
  BACKUP_FILE="/backups/$BACKUP_FILE"
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found: $BACKUP_FILE"
  exit 1
fi

# ─── Integrity check ──────────────────────────────────────────────────────────
echo "[restore] Verifying backup integrity: $BACKUP_FILE"
if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
  echo "ERROR: Backup file is corrupt (gzip -t failed): $BACKUP_FILE"
  exit 1
fi

FILE_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[restore] File OK — size: $FILE_SIZE"

# ─── Confirmation ─────────────────────────────────────────────────────────────
if [ "${RESTORE_NO_CONFIRM:-0}" != "1" ]; then
  echo ""
  echo "⚠️  WARNING: This will DROP and recreate the database '$MYSQL_DATABASE' on host '$MYSQL_HOST'."
  echo "   All existing data will be permanently deleted."
  echo ""
  printf "Type YES to continue: "
  read CONFIRM
  if [ "$CONFIRM" != "YES" ]; then
    echo "Restore cancelled."
    exit 0
  fi
fi

# ─── Drop and recreate database ───────────────────────────────────────────────
echo "[restore] Dropping and recreating database '$MYSQL_DATABASE'..."
mysql \
  -h "$MYSQL_HOST" \
  -u "$MYSQL_USER" \
  -p"$MYSQL_PASSWORD" \
  -e "DROP DATABASE IF EXISTS \`$MYSQL_DATABASE\`; CREATE DATABASE \`$MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# ─── Restore ──────────────────────────────────────────────────────────────────
echo "[restore] Restoring from $BACKUP_FILE ..."
gunzip -c "$BACKUP_FILE" | mysql \
  -h "$MYSQL_HOST" \
  -u "$MYSQL_USER" \
  -p"$MYSQL_PASSWORD" \
  "$MYSQL_DATABASE"

# ─── Verify ───────────────────────────────────────────────────────────────────
TABLE_COUNT=$(mysql \
  -h "$MYSQL_HOST" \
  -u "$MYSQL_USER" \
  -p"$MYSQL_PASSWORD" \
  -sNe "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$MYSQL_DATABASE';" 2>/dev/null)

echo "[restore] SUCCESS — $TABLE_COUNT tables restored to '$MYSQL_DATABASE'"
echo "[restore] Run 'npx prisma generate' and restart the backend to reconnect."
