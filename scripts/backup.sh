#!/bin/sh
# HALQA Database Backup Script
#
# Runs mysqldump, compresses to gzip, verifies the output, and optionally
# sends a Slack failure notification (REQ-19.4).
#
# Environment variables (read from the container environment):
#   MYSQL_HOST       — MySQL hostname (default: mysql)
#   MYSQL_USER       — MySQL username
#   MYSQL_PASSWORD   — MySQL password
#   MYSQL_DATABASE   — Database name (default: halqa_db)
#   BACKUP_KEEP_DAYS — Days of backups to retain (default: 7)
#   SLACK_WEBHOOK_URL — Optional Slack webhook for failure alerts
#
# Usage:
#   sh /backup/backup.sh

set -e

MYSQL_HOST="${MYSQL_HOST:-mysql}"
MYSQL_DATABASE="${MYSQL_DATABASE:-halqa_db}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILE="/backups/halqa_${TIMESTAMP}.sql.gz"

# ─── Failure notification helper ─────────────────────────────────────────────
notify_failure() {
  MESSAGE="$1"
  echo "[backup] ERROR: ${MESSAGE}" >&2

  if [ -n "${SLACK_WEBHOOK_URL}" ]; then
    # REQ-19.4: Send failure notification to Slack
    curl -s -X POST "${SLACK_WEBHOOK_URL}" \
      -H 'Content-type: application/json' \
      --data "{\"text\":\"⚠️ HALQA backup FAILED (${TIMESTAMP}): ${MESSAGE}\"}" \
      --max-time 10 \
      || true  # curl failure must not abort the script
  fi

  exit 1
}

# ─── Run mysqldump and gzip ───────────────────────────────────────────────────
echo "[backup] Starting backup → ${FILE}"

mysqldump \
  -h "${MYSQL_HOST}" \
  -u "${MYSQL_USER}" \
  -p"${MYSQL_PASSWORD}" \
  --single-transaction \
  --routines \
  --triggers \
  "${MYSQL_DATABASE}" \
  | gzip > "${FILE}"

# ─── REQ-19.4: Verify the output file ────────────────────────────────────────

# Check the file is not empty
if [ ! -s "${FILE}" ]; then
  notify_failure "Backup file is empty: ${FILE}"
fi

# Verify gzip integrity
if ! gzip -t "${FILE}" 2>/dev/null; then
  notify_failure "Backup file is corrupt (gzip -t failed): ${FILE}"
fi

# ─── Log success ─────────────────────────────────────────────────────────────
FILE_SIZE=$(du -sh "${FILE}" | cut -f1)
echo "[backup] SUCCESS: ${FILE} (${FILE_SIZE})"

# ─── Prune old backups ────────────────────────────────────────────────────────
find /backups -name "halqa_*.sql.gz" -mtime +"${BACKUP_KEEP_DAYS}" -delete
echo "[backup] Old backups pruned (retention: ${BACKUP_KEEP_DAYS} days)"
