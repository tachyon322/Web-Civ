package main

import (
	"bytes"
	"database/sql"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

type fakeGeo struct{}

func (fakeGeo) Country(ip netip.Addr) string {
	if ip.String() == "203.0.113.7" {
		return "RU"
	}
	return ""
}

func testApp(t *testing.T) *app {
	t.Helper()
	db, err := openDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	now := time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)
	return &app{
		db:            db,
		secret:        []byte("test-secret-0123456789"),
		geo:           fakeGeo{},
		limiter:       newLimiter(60, 100),
		adminUser:     "admin",
		adminPassword: "pw",
		templates:     parseTemplates(),
		static: fstest.MapFS{
			"index.html":        {Data: []byte("<html>game</html>")},
			"assets/index-1.js": {Data: []byte("js")},
		},
		now: func() time.Time { return now },
	}
}

func post(t *testing.T, a *app, path, body, remote string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.RemoteAddr = remote
	rec := httptest.NewRecorder()
	a.routes().ServeHTTP(rec, req)
	return rec
}

func count(t *testing.T, db *sql.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestLoginCreatesPlayerAndVisitWithoutRawIP(t *testing.T) {
	a := testApp(t)
	rec := post(t, a, "/api/login", `{"login":"Денис_42","browserId":"b-1"}`, "203.0.113.7:5555")
	if rec.Code != 200 {
		t.Fatalf("код %d: %s", rec.Code, rec.Body)
	}
	// Повторный вход другим регистром — тот же игрок, второй визит.
	post(t, a, "/api/login", `{"login":"ДЕНИС_42","browserId":"b-2"}`, "203.0.113.7:5555")
	if n := count(t, a.db, `SELECT COUNT(*) FROM players`); n != 1 {
		t.Fatalf("игроков %d, ожидался 1", n)
	}
	if n := count(t, a.db, `SELECT COUNT(*) FROM visits WHERE country = 'RU' AND length(ip_hash) = 64`); n != 2 {
		t.Fatalf("визитов со страной и хэшем: %d", n)
	}
	// Сырой IP нигде в базе не лежит.
	for _, q := range []string{`SELECT COUNT(*) FROM visits WHERE ip_hash LIKE '%203.0.113%'`, `SELECT COUNT(*) FROM events WHERE data LIKE '%203.0.113%'`} {
		if n := count(t, a.db, q); n != 0 {
			t.Fatal("в базе найден IP")
		}
	}
	var login string
	a.db.QueryRow(`SELECT login FROM players`).Scan(&login)
	if login != "денис_42" {
		t.Fatalf("логин хранится как %q", login)
	}
}

func TestLoginBehindProxyUsesForwardedFor(t *testing.T) {
	a := testApp(t)
	req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"login":"abc","browserId":"x"}`))
	req.RemoteAddr = "127.0.0.1:4000"
	req.Header.Set("X-Forwarded-For", "203.0.113.7")
	rec := httptest.NewRecorder()
	a.routes().ServeHTTP(rec, req)
	if n := count(t, a.db, `SELECT COUNT(*) FROM visits WHERE country = 'RU'`); rec.Code != 200 || n != 1 {
		t.Fatalf("код %d, визитов из RU %d", rec.Code, n)
	}
	// Заголовку от не-локального адреса не верим.
	req = httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "198.51.100.1:1"
	req.Header.Set("X-Forwarded-For", "203.0.113.7")
	if ip := clientIP(req); ip.String() != "198.51.100.1" {
		t.Fatalf("адрес %s", ip)
	}
}

func TestLoginValidation(t *testing.T) {
	a := testApp(t)
	for _, body := range []string{
		`{"login":"ab","browserId":"x"}`,
		`{"login":"слишком_длинное_имя_игрока","browserId":"x"}`,
		`{"login":"bad name","browserId":"x"}`,
		`{"login":"ok_name","browserId":"<script>"}`,
		`{"login":"ok_name","browserId":"x","extra":1}`,
		`не json`,
	} {
		if rec := post(t, a, "/api/login", body, "198.51.100.1:1"); rec.Code != 400 {
			t.Errorf("%s: код %d", body, rec.Code)
		}
	}
	big := `{"login":"abc","browserId":"` + strings.Repeat("a", 5000) + `"}`
	if rec := post(t, a, "/api/login", big, "198.51.100.1:1"); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("большое тело: код %d", rec.Code)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/login", nil)
	rec := httptest.NewRecorder()
	a.routes().ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Errorf("GET /api/login не должен работать")
	}
	if n := count(t, a.db, `SELECT COUNT(*) FROM players`); n != 0 {
		t.Fatalf("создано игроков: %d", n)
	}
}

func TestEventsAreValidatedAndStoredClean(t *testing.T) {
	a := testApp(t)
	ok := []string{
		`{"login":"abc","browserId":"x","type":"game_start","data":{"nation":"rome","powers":12,"difficulty":"hard","seed":42}}`,
		`{"login":"abc","browserId":"x","type":"game_end","data":{"result":"win","victory":"science","turns":150}}`,
		`{"login":"abc","browserId":"x","type":"game_end","data":{"result":"loss","victory":null,"turns":80}}`,
		`{"login":"abc","browserId":"x","type":"game_abandon","data":{"turn":12}}`,
	}
	for _, body := range ok {
		if rec := post(t, a, "/api/event", body, "198.51.100.1:1"); rec.Code != 200 {
			t.Fatalf("%s: код %d %s", body, rec.Code, rec.Body)
		}
	}
	bad := []string{
		`{"login":"abc","browserId":"x","type":"cheat","data":{}}`,
		`{"login":"abc","browserId":"x","type":"game_start","data":{"nation":"rome","powers":99,"difficulty":"hard","seed":1}}`,
		`{"login":"abc","browserId":"x","type":"game_start","data":{"nation":"rome","powers":4,"difficulty":"hard","seed":1,"x":"y"}}`,
		`{"login":"abc","browserId":"x","type":"game_end","data":{"result":"win","victory":"magic","turns":3}}`,
		`{"login":"abc","browserId":"x","type":"game_abandon","data":{"turn":0}}`,
	}
	for _, body := range bad {
		if rec := post(t, a, "/api/event", body, "198.51.100.1:1"); rec.Code != 400 {
			t.Errorf("%s: код %d", body, rec.Code)
		}
	}
	if n := count(t, a.db, `SELECT COUNT(*) FROM events`); n != 4 {
		t.Fatalf("событий %d", n)
	}
	var data string
	a.db.QueryRow(`SELECT data FROM events WHERE type = 'game_start'`).Scan(&data)
	if data != `{"nation":"rome","powers":12,"difficulty":"hard","seed":42}` {
		t.Fatalf("данные: %s", data)
	}
}

func TestRateLimit(t *testing.T) {
	a := testApp(t)
	a.limiter = newLimiter(60, 3)
	codes := []int{}
	for i := 0; i < 5; i++ {
		codes = append(codes, post(t, a, "/api/login", `{"login":"abc","browserId":"x"}`, "198.51.100.1:1").Code)
	}
	if codes[2] != 200 || codes[3] != 429 || codes[4] != 429 {
		t.Fatalf("коды %v", codes)
	}
	// Другой адрес — своё ведро.
	if c := post(t, a, "/api/login", `{"login":"abc","browserId":"x"}`, "198.51.100.2:1").Code; c != 200 {
		t.Fatalf("другой адрес: %d", c)
	}
}

func TestStatsRequiresAdminAndRenders(t *testing.T) {
	a := testApp(t)
	post(t, a, "/api/login", `{"login":"abc","browserId":"x"}`, "203.0.113.7:1")
	post(t, a, "/api/login", `{"login":"abc","browserId":"y"}`, "203.0.113.7:1")
	post(t, a, "/api/event", `{"login":"abc","browserId":"x","type":"game_start","data":{"nation":"greece","powers":6,"difficulty":"normal","seed":1}}`, "203.0.113.7:1")
	post(t, a, "/api/event", `{"login":"abc","browserId":"x","type":"game_end","data":{"result":"win","victory":"culture","turns":140}}`, "203.0.113.7:1")

	get := func(user, pass string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/stats", nil)
		if user != "" {
			req.SetBasicAuth(user, pass)
		}
		rec := httptest.NewRecorder()
		a.routes().ServeHTTP(rec, req)
		return rec
	}
	if c := get("", "").Code; c != 401 {
		t.Fatalf("без входа: %d", c)
	}
	if c := get("admin", "wrong").Code; c != 401 {
		t.Fatalf("неверный пароль: %d", c)
	}
	rec := get("admin", "pw")
	body := rec.Body.String()
	for _, want := range []string{"Игроков<b>1</b>", "Греция", "победа игрока: культура", "RU", "2026-10-03"} {
		if !strings.Contains(body, want) {
			t.Errorf("на странице нет %q", want)
		}
	}
	if rec.Code != 200 || !strings.Contains(body, "<td>abc</td>") {
		t.Fatalf("код %d или нет общего логина", rec.Code)
	}
	a.adminPassword = ""
	if c := get("admin", "").Code; c != 404 {
		t.Fatalf("без пароля администратора /stats должна быть выключена: %d", c)
	}
}

func TestStaticCaching(t *testing.T) {
	a := testApp(t)
	cases := map[string]string{"/": "no-cache", "/assets/index-1.js": "immutable"}
	for path, want := range cases {
		rec := httptest.NewRecorder()
		a.routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != 200 || !strings.Contains(rec.Header().Get("Cache-Control"), want) {
			t.Errorf("%s: код %d, кэш %q", path, rec.Code, rec.Header().Get("Cache-Control"))
		}
		if rec.Header().Get("Content-Security-Policy") == "" {
			t.Errorf("%s: нет CSP", path)
		}
	}
	rec := httptest.NewRecorder()
	a.routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/nope", nil))
	if rec.Code != 404 {
		t.Errorf("неизвестный путь: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	a.routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/privacy", nil))
	b, _ := io.ReadAll(rec.Body)
	if rec.Code != 200 || !bytes.Contains(b, []byte("хэш IP")) {
		t.Errorf("/privacy: %d", rec.Code)
	}
}

func TestMigrationsAreIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "m.db")
	for i := 0; i < 2; i++ {
		db, err := openDB(path)
		if err != nil {
			t.Fatal(err)
		}
		var v int
		db.QueryRow(`PRAGMA user_version`).Scan(&v)
		var mode string
		db.QueryRow(`PRAGMA journal_mode`).Scan(&mode)
		db.Close()
		if v != len(migrations) || mode != "wal" {
			t.Fatalf("версия %d, режим %s", v, mode)
		}
	}
}
