#!/usr/bin/env bash
# Ежедневный бэкап базы: sqlite3 .backup (безопасно при работающем сервере), хранится 14 копий.
# cron пользователя civ: 17 4 * * * /opt/civ/backup.sh
set -euo pipefail
db="${CIV_DB:-/var/lib/civ/civ.db}"
dir="${CIV_BACKUP_DIR:-/var/lib/civ/backups}"
keep="${CIV_BACKUP_KEEP:-14}"

mkdir -p "$dir"
file="$dir/civ-$(date -u +%Y%m%d-%H%M%S).db"
sqlite3 "$db" ".backup '$file'"
gzip "$file"
ls -1t "$dir"/civ-*.db.gz | tail -n +"$((keep + 1))" | xargs -r rm --
