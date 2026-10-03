#!/usr/bin/env bash
# Свежая офлайн-база стран DB-IP «IP to Country Lite» (CC BY 4.0, обновляется раз в месяц).
# cron root (sudo crontab -e): 30 5 3 * * CIV_GEO_DB=/var/lib/civ/country.mmdb /opt/civ/update-geo.sh && systemctl restart civ
set -euo pipefail
dest="${CIV_GEO_DB:-/var/lib/civ/country.mmdb}"
month="$(date -u +%Y-%m)"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
if ! curl -fsSL "https://download.db-ip.com/free/dbip-country-lite-$month.mmdb.gz" -o "$tmp"; then
	# В первые дни месяца новой базы может ещё не быть — берём прошлый месяц.
	month="$(date -u -d "$(date -u +%Y-%m-01) -1 day" +%Y-%m)"
	curl -fsSL "https://download.db-ip.com/free/dbip-country-lite-$month.mmdb.gz" -o "$tmp"
fi
gunzip -c "$tmp" > "$dest.new"
mv "$dest.new" "$dest"
echo "База стран обновлена: $month"
