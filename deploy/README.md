# Выкладка на свой VPS

Сервер — один бинарник Go со встроенной игрой. Служба — systemd, база — SQLite в `/var/lib/civ`.
HTTPS-прокси (Caddy) настраивается отдельно и здесь не описан.
Минимальной машины (1 ядро, 1 ГБ, Debian/Ubuntu) хватает с запасом.

## Сборка (на своём компьютере)

Нужны Node.js 22+ и Go 1.24+.

```sh
deploy/build.sh          # тесты, сборка клиента, копия в server/web, бинарник server/civ-server (Linux amd64)
```

## Первая установка (на VPS)

1. Пакеты: `sudo apt install sqlite3 curl`.
2. Прокси перед сервером (Caddy) — настраивается отдельно. Что нужно от него серверу: проксировать на `127.0.0.1:47613` (адрес задаётся `CIV_ADDR`) и передавать адрес игрока в `X-Forwarded-For` — сервер верит этому заголовку только от локального адреса. Чтобы IP не попадали в логи, журнал доступа прокси лучше не включать.
3. Пользователь и каталоги:
   ```sh
   sudo useradd --system --home /var/lib/civ --shell /usr/sbin/nologin civ
   sudo mkdir -p /opt/civ /var/lib/civ /etc/civ
   sudo chown civ:civ /var/lib/civ
   ```
4. Файлы (с локальной машины):
   ```sh
   scp server/civ-server deploy/backup.sh deploy/update-geo.sh user@vps:/tmp/
   scp deploy/civ.service deploy/civ.env.example user@vps:/tmp/
   ```
   На VPS:
   ```sh
   sudo install -m 755 /tmp/civ-server /tmp/backup.sh /tmp/update-geo.sh /opt/civ/
   sudo install -m 644 /tmp/civ.service /etc/systemd/system/civ.service
   sudo install -m 600 /tmp/civ.env.example /etc/civ/civ.env
   ```
5. Настройки в `/etc/civ/civ.env`: `CIV_IP_SECRET` (`openssl rand -hex 32`), `CIV_ADMIN_PASSWORD` для `/stats`.
6. База стран: `sudo CIV_GEO_DB=/var/lib/civ/country.mmdb /opt/civ/update-geo.sh`.
7. Запуск: `sudo systemctl daemon-reload && sudo systemctl enable --now civ`. Проверка: `curl -s http://127.0.0.1:47613/healthz` → `ok`.
8. Расписание:
   - бэкап (пользователь civ, `sudo crontab -u civ -e`): `17 4 * * * /opt/civ/backup.sh` — 14 сжатых копий в `/var/lib/civ/backups`;
   - база стран раз в месяц (root, `sudo crontab -e`): `30 5 3 * * CIV_GEO_DB=/var/lib/civ/country.mmdb /opt/civ/update-geo.sh && systemctl restart civ`.

## Обновление игры

```sh
deploy/build.sh
scp server/civ-server user@vps:/tmp/
ssh user@vps 'sudo install -m 755 /tmp/civ-server /opt/civ/ && sudo systemctl restart civ'
```

Схема базы мигрирует сама при старте. Сохранения игроков лежат у них в браузере и тоже проходят миграцию формата.

## Что где

| Что | Где |
| --- | --- |
| Игра | `https://домен/` |
| Статистика (логин и пароль из `civ.env`) | `https://домен/stats` |
| Что собирается | `https://домен/privacy` |
| База | `/var/lib/civ/civ.db` (WAL) |
| Логи сервера | `journalctl -u civ` (IP в логи не пишутся) |

Сырой IP нигде не сохраняется: сервер определяет по нему страну, считает HMAC и забывает адрес;
сам сервер адреса в журнал не пишет.
