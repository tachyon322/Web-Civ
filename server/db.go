package main

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// Схема растёт только добавлением шагов в конец списка: номер текущей версии хранится
// в PRAGMA user_version, при старте применяются недостающие шаги.
var migrations = []string{
	`CREATE TABLE players (
		id         INTEGER PRIMARY KEY,
		login      TEXT NOT NULL UNIQUE COLLATE NOCASE,
		first_seen INTEGER NOT NULL,
		last_seen  INTEGER NOT NULL
	);
	CREATE TABLE visits (
		id         INTEGER PRIMARY KEY,
		player_id  INTEGER NOT NULL REFERENCES players(id),
		browser_id TEXT NOT NULL,
		ip_hash    TEXT,
		country    TEXT,
		ts         INTEGER NOT NULL
	);
	CREATE TABLE events (
		id         INTEGER PRIMARY KEY,
		player_id  INTEGER NOT NULL REFERENCES players(id),
		browser_id TEXT NOT NULL,
		type       TEXT NOT NULL,
		data       TEXT,
		ts         INTEGER NOT NULL
	);
	CREATE INDEX visits_ts ON visits(ts);
	CREATE INDEX events_type_ts ON events(type, ts);`,
}

// openDB открывает базу в режиме WAL и применяет миграции схемы.
func openDB(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite пишет одним писателем; одно соединение избавляет от «database is locked».
	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func migrate(db *sql.DB) error {
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	for i := version; i < len(migrations); i++ {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(migrations[i]); err != nil {
			tx.Rollback()
			return fmt.Errorf("миграция %d: %w", i+1, err)
		}
		if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, i+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// upsertPlayer создаёт игрока или обновляет время последнего входа; возвращает id.
func upsertPlayer(db *sql.DB, login string, now int64) (int64, error) {
	var id int64
	err := db.QueryRow(
		`INSERT INTO players (login, first_seen, last_seen) VALUES (?, ?, ?)
		 ON CONFLICT(login) DO UPDATE SET last_seen = excluded.last_seen
		 RETURNING id`,
		login, now, now,
	).Scan(&id)
	return id, err
}

func insertVisit(db *sql.DB, playerID int64, browserID, ipHash, country string, now int64) error {
	_, err := db.Exec(
		`INSERT INTO visits (player_id, browser_id, ip_hash, country, ts) VALUES (?, ?, ?, ?, ?)`,
		playerID, browserID, nullable(ipHash), nullable(country), now,
	)
	return err
}

func insertEvent(db *sql.DB, playerID int64, browserID, typ, data string, now int64) error {
	_, err := db.Exec(
		`INSERT INTO events (player_id, browser_id, type, data, ts) VALUES (?, ?, ?, ?, ?)`,
		playerID, browserID, typ, data, now,
	)
	return err
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
