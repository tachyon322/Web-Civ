#!/usr/bin/env bash
# Сборка: клиент (npm) → копия в server/web → один бинарник Go со встроенной игрой.
# По умолчанию бинарник для Linux amd64 (VPS); другая платформа: GOOS=… GOARCH=… deploy/build.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

npm --prefix "$root/client" ci
npm --prefix "$root/client" test
npm --prefix "$root/client" run build

find "$root/server/web" -mindepth 1 ! -name README.txt -exec rm -rf {} +
cp -r "$root/client/dist/." "$root/server/web/"

cd "$root/server"
go test ./...
CGO_ENABLED=0 GOOS="${GOOS:-linux}" GOARCH="${GOARCH:-amd64}" go build -trimpath -ldflags="-s -w" -o civ-server .
echo "Готово: $root/server/civ-server"
