package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Логин: 3–20 символов, буквы любого алфавита, цифры и «_». Регистр не различается:
// храним в нижнем регистре (COLLATE NOCASE в SQLite складывает только латиницу).
var (
	loginRe     = regexp.MustCompile(`^[\p{L}\p{N}_]{3,20}$`)
	browserIDRe = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)
)

const maxBody = 2048

func normalizeLogin(s string) (string, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	n := utf8.RuneCountInString(s)
	return s, n >= 3 && n <= 20 && loginRe.MatchString(s)
}

type apiError struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// readJSON читает небольшое тело строго: размер, формат, никаких лишних полей. Метод проверяет маршрут.
func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, apiError{"Слишком большой запрос"})
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{"Неверный формат"})
		return err
	}
	return nil
}

// limited — проверка частоты по хэшу адреса; true — запрос отклонён.
func (a *app) limited(w http.ResponseWriter, r *http.Request) bool {
	if a.limiter.allow(ipHash(a.secret, clientIP(r)), a.now()) {
		return false
	}
	writeJSON(w, http.StatusTooManyRequests, apiError{"Слишком много запросов, попробуйте позже"})
	return true
}

type identity struct {
	Login     string `json:"login"`
	BrowserID string `json:"browserId"`
}

func (id *identity) validate() (string, bool) {
	login, ok := normalizeLogin(id.Login)
	if !ok {
		return "Логин: 3–20 символов — буквы, цифры, «_»", false
	}
	if !browserIDRe.MatchString(id.BrowserID) {
		return "Неверный идентификатор браузера", false
	}
	id.Login = login
	return "", true
}

// POST /api/login — создаёт игрока или обновляет время входа и пишет визит: страна и хэш IP.
func (a *app) handleLogin(w http.ResponseWriter, r *http.Request) {
	if a.limited(w, r) {
		return
	}
	var req identity
	if readJSON(w, r, &req) != nil {
		return
	}
	if msg, ok := req.validate(); !ok {
		writeJSON(w, http.StatusBadRequest, apiError{msg})
		return
	}
	now := a.now().Unix()
	id, err := upsertPlayer(a.db, req.Login, now)
	if err != nil {
		a.fail(w, err)
		return
	}
	ip := clientIP(r)
	if err := insertVisit(a.db, id, req.BrowserID, ipHash(a.secret, ip), a.geo.Country(ip), now); err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Данные событий проверяются по типу и сохраняются заново сериализованными — без чужих полей.
type gameStart struct {
	Nation     string `json:"nation"`
	Powers     int    `json:"powers"`
	Difficulty string `json:"difficulty"`
	Seed       int64  `json:"seed"`
}

type gameEnd struct {
	Result  string  `json:"result"`
	Victory *string `json:"victory"`
	Turns   int     `json:"turns"`
}

type gameAbandon struct {
	Turn int `json:"turn"`
}

var (
	nationRe     = regexp.MustCompile(`^[a-z]{2,20}$`)
	difficulties = map[string]bool{"easy": true, "normal": true, "hard": true}
	victories    = map[string]bool{"conquest": true, "federation": true, "science": true, "culture": true}
)

func validateEvent(typ string, raw json.RawMessage) (string, bool) {
	strict := func(v any) bool {
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		return dec.Decode(v) == nil
	}
	var v any
	switch typ {
	case "game_start":
		var d gameStart
		if !strict(&d) || !nationRe.MatchString(d.Nation) || d.Powers < 2 || d.Powers > 12 || !difficulties[d.Difficulty] || d.Seed < 0 {
			return "", false
		}
		v = d
	case "game_end":
		var d gameEnd
		if !strict(&d) || (d.Result != "win" && d.Result != "loss") || (d.Victory != nil && !victories[*d.Victory]) || d.Turns < 1 || d.Turns > 100000 {
			return "", false
		}
		v = d
	case "game_abandon":
		var d gameAbandon
		if !strict(&d) || d.Turn < 1 || d.Turn > 100000 {
			return "", false
		}
		v = d
	default:
		return "", false
	}
	out, _ := json.Marshal(v)
	return string(out), true
}

// POST /api/event — событие партии: начало, итог, брошенная партия.
func (a *app) handleEvent(w http.ResponseWriter, r *http.Request) {
	if a.limited(w, r) {
		return
	}
	var req struct {
		identity
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if readJSON(w, r, &req) != nil {
		return
	}
	if msg, ok := req.identity.validate(); !ok {
		writeJSON(w, http.StatusBadRequest, apiError{msg})
		return
	}
	data, ok := validateEvent(req.Type, req.Data)
	if !ok {
		writeJSON(w, http.StatusBadRequest, apiError{"Неизвестное событие или неверные данные"})
		return
	}
	now := a.now().Unix()
	id, err := upsertPlayer(a.db, req.Login, now)
	if err != nil {
		a.fail(w, err)
		return
	}
	if err := insertEvent(a.db, id, req.BrowserID, req.Type, data, now); err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *app) fail(w http.ResponseWriter, err error) {
	if !errors.Is(err, sql.ErrNoRows) {
		log.Printf("ошибка API: %v", err)
	}
	writeJSON(w, http.StatusInternalServerError, apiError{"Ошибка сервера"})
}
