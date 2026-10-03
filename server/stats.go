package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"html/template"
	"net/http"
	"time"
)

// Названия наций для страницы статистики (ключи — id из client/src/data/nations.json).
var nationNames = map[string]string{
	"rome": "Рим", "mongols": "Монголы", "japan": "Япония", "china": "Китай", "arabia": "Арабы",
	"egypt": "Египет", "greece": "Греция", "france": "Франция", "carthage": "Карфаген", "india": "Индия",
	"russia": "Россия", "persia": "Персия", "byzantium": "Византия",
}

var victoryNames = map[string]string{
	"conquest": "завоевание", "federation": "федерация", "science": "наука", "culture": "культура",
}

type dayRow struct {
	Day     string
	New     int
	Active  int
	Unique  int
	Started int
}

type countRow struct {
	Name  string
	Count int
}

type statsPage struct {
	Generated  string
	Players    int
	Visits     int
	Started    int
	Finished   int
	Abandoned  int
	Wins       int
	AvgTurns   float64
	AvgAbandon float64
	Days       []dayRow
	Victories  []countRow
	Nations    []countRow
	Difficulty []countRow
	Countries  []countRow
	Shared     []countRow
}

// checkAdmin — вход на /stats по логину и паролю администратора (HTTP Basic, только по HTTPS через Caddy).
func (a *app) checkAdmin(w http.ResponseWriter, r *http.Request) bool {
	user, pass, ok := r.BasicAuth()
	eq := func(x, y string) bool {
		hx, hy := sha256.Sum256([]byte(x)), sha256.Sum256([]byte(y))
		return subtle.ConstantTimeCompare(hx[:], hy[:]) == 1
	}
	if ok && eq(user, a.adminUser) && eq(pass, a.adminPassword) {
		return true
	}
	w.Header().Set("WWW-Authenticate", `Basic realm="stats", charset="UTF-8"`)
	http.Error(w, "Нужен вход администратора", http.StatusUnauthorized)
	return false
}

// GET /stats — закрытая страница: игроки, визиты, партии, победы, нации, страны.
func (a *app) handleStats(w http.ResponseWriter, r *http.Request) {
	if a.adminPassword == "" {
		http.NotFound(w, r)
		return
	}
	if !a.limiter.allow("stats:"+ipHash(a.secret, clientIP(r)), a.now()) {
		http.Error(w, "Слишком много попыток, попробуйте позже", http.StatusTooManyRequests)
		return
	}
	if !a.checkAdmin(w, r) {
		return
	}
	page, err := a.collectStats(30)
	if err != nil {
		a.fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := a.templates.ExecuteTemplate(w, "stats.html", page); err != nil {
		a.fail(w, err)
	}
}

func (a *app) collectStats(days int) (*statsPage, error) {
	db := a.db
	now := a.now().UTC()
	p := &statsPage{Generated: now.Format("02.01.2006 15:04 UTC")}
	scalars := []struct {
		dst   any
		query string
	}{
		{&p.Players, `SELECT COUNT(*) FROM players`},
		{&p.Visits, `SELECT COUNT(*) FROM visits`},
		{&p.Started, `SELECT COUNT(*) FROM events WHERE type = 'game_start'`},
		{&p.Finished, `SELECT COUNT(*) FROM events WHERE type = 'game_end'`},
		{&p.Abandoned, `SELECT COUNT(*) FROM events WHERE type = 'game_abandon'`},
		{&p.Wins, `SELECT COUNT(*) FROM events WHERE type = 'game_end' AND json_extract(data, '$.result') = 'win'`},
		{&p.AvgTurns, `SELECT COALESCE(AVG(json_extract(data, '$.turns')), 0) FROM events WHERE type = 'game_end'`},
		{&p.AvgAbandon, `SELECT COALESCE(AVG(json_extract(data, '$.turn')), 0) FROM events WHERE type = 'game_abandon'`},
	}
	for _, s := range scalars {
		if err := db.QueryRow(s.query).Scan(s.dst); err != nil {
			return nil, err
		}
	}

	// По дням за последние N дней (UTC), включая дни без событий.
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -(days - 1))
	byDay := map[string]*dayRow{}
	for i := days - 1; i >= 0; i-- {
		d := start.AddDate(0, 0, i).Format("2006-01-02")
		row := &dayRow{Day: d}
		byDay[d] = row
		p.Days = append(p.Days, *row)
	}
	daily := []struct {
		query string
		set   func(*dayRow, int)
	}{
		{`SELECT date(first_seen, 'unixepoch'), COUNT(*) FROM players WHERE first_seen >= ? GROUP BY 1`, func(r *dayRow, n int) { r.New = n }},
		{`SELECT date(ts, 'unixepoch'), COUNT(DISTINCT player_id) FROM visits WHERE ts >= ? GROUP BY 1`, func(r *dayRow, n int) { r.Active = n }},
		{`SELECT date(ts, 'unixepoch'), COUNT(DISTINCT ip_hash) FROM visits WHERE ts >= ? GROUP BY 1`, func(r *dayRow, n int) { r.Unique = n }},
		{`SELECT date(ts, 'unixepoch'), COUNT(*) FROM events WHERE type = 'game_start' AND ts >= ? GROUP BY 1`, func(r *dayRow, n int) { r.Started = n }},
	}
	for _, d := range daily {
		rows, err := countRows(db, d.query, start.Unix())
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			if row := byDay[r.Name]; row != nil {
				d.set(row, r.Count)
			}
		}
	}
	for i := range p.Days {
		p.Days[i] = *byDay[p.Days[i].Day]
	}

	var err error
	if p.Victories, err = countRows(db, `SELECT json_extract(data, '$.result') || '|' || COALESCE(json_extract(data, '$.victory'), ''), COUNT(*)
		FROM events WHERE type = 'game_end' GROUP BY 1 ORDER BY 2 DESC`); err != nil {
		return nil, err
	}
	for i, v := range p.Victories {
		p.Victories[i].Name = victoryLabel(v.Name)
	}
	if p.Nations, err = countRows(db, `SELECT json_extract(data, '$.nation'), COUNT(*) FROM events WHERE type = 'game_start' GROUP BY 1 ORDER BY 2 DESC`); err != nil {
		return nil, err
	}
	for i, n := range p.Nations {
		if name, ok := nationNames[n.Name]; ok {
			p.Nations[i].Name = name
		}
	}
	if p.Difficulty, err = countRows(db, `SELECT json_extract(data, '$.difficulty'), COUNT(*) FROM events WHERE type = 'game_start' GROUP BY 1 ORDER BY 2 DESC`); err != nil {
		return nil, err
	}
	if p.Countries, err = countRows(db, `SELECT COALESCE(country, '—'), COUNT(DISTINCT player_id) FROM visits GROUP BY 1 ORDER BY 2 DESC LIMIT 40`); err != nil {
		return nil, err
	}
	// Один логин из нескольких браузеров — возможно, двое ввели одно имя.
	if p.Shared, err = countRows(db, `SELECT p.login, COUNT(DISTINCT v.browser_id) FROM visits v JOIN players p ON p.id = v.player_id
		GROUP BY v.player_id HAVING COUNT(DISTINCT v.browser_id) > 1 ORDER BY 2 DESC LIMIT 20`); err != nil {
		return nil, err
	}
	return p, nil
}

func victoryLabel(key string) string {
	result, kind, _ := cutLast(key, '|')
	name := victoryNames[kind]
	if name == "" {
		name = "выбыл"
	}
	if result == "win" {
		return "победа игрока: " + name
	}
	return "поражение: " + name
}

func cutLast(s string, sep byte) (string, string, bool) {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == sep {
			return s[:i], s[i+1:], true
		}
	}
	return s, "", false
}

func countRows(db *sql.DB, query string, args ...any) ([]countRow, error) {
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []countRow
	for rows.Next() {
		var name sql.NullString
		var r countRow
		if err := rows.Scan(&name, &r.Count); err != nil {
			return nil, err
		}
		r.Name = name.String
		out = append(out, r)
	}
	return out, rows.Err()
}

func parseTemplates() *template.Template {
	return template.Must(template.New("").Funcs(template.FuncMap{
		"pct": func(a, b int) int {
			if b == 0 {
				return 0
			}
			return a * 100 / b
		},
	}).ParseFS(templateFS, "templates/*.html"))
}
