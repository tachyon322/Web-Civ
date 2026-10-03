// Сервер игры: один бинарник, встроенный клиент (go:embed), вход игроков и события партий в SQLite,
// закрытая страница статистики. Ходы и сохранения на сервер не приходят.
package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"embed"
	"errors"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/tachyon322/Web-Civ/server/geo"
)

//go:embed all:web
var webFS embed.FS

//go:embed templates
var templateFS embed.FS

type app struct {
	db            *sql.DB
	secret        []byte
	geo           geo.Lookup
	limiter       *limiter
	adminUser     string
	adminPassword string
	templates     *template.Template
	static        fs.FS
	now           func() time.Time
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil && n > 0 {
		return n
	}
	return def
}

func main() {
	addr := env("CIV_ADDR", "127.0.0.1:47613")
	db, err := openDB(env("CIV_DB", "civ.db"))
	if err != nil {
		log.Fatalf("база: %v", err)
	}
	defer db.Close()

	secret := []byte(os.Getenv("CIV_IP_SECRET"))
	if len(secret) < 16 {
		log.Print("CIV_IP_SECRET не задан или короче 16 символов: хэши IP будут меняться после перезапуска")
		secret = make([]byte, 32)
		rand.Read(secret)
	}

	var lookup geo.Lookup = geo.None{}
	if path := os.Getenv("CIV_GEO_DB"); path != "" {
		g, err := geo.Open(path)
		if err != nil {
			log.Printf("база стран %s не открылась (%v): страна не будет определяться", path, err)
		} else {
			defer g.Close()
			lookup = g
		}
	}

	static, _ := fs.Sub(webFS, "web")
	a := &app{
		db:            db,
		secret:        secret,
		geo:           lookup,
		limiter:       newLimiter(envInt("CIV_RATE_PER_MINUTE", 30), envInt("CIV_RATE_BURST", 20)),
		adminUser:     env("CIV_ADMIN_USER", "admin"),
		adminPassword: os.Getenv("CIV_ADMIN_PASSWORD"),
		templates:     parseTemplates(),
		static:        static,
		now:           time.Now,
	}
	if a.adminPassword == "" {
		log.Print("CIV_ADMIN_PASSWORD не задан: /stats отключена")
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           a.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		log.Printf("слушаю %s", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/login", a.handleLogin)
	mux.HandleFunc("POST /api/event", a.handleEvent)
	mux.HandleFunc("GET /stats", a.handleStats)
	mux.HandleFunc("GET /privacy", a.handlePrivacy)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("GET /", a.handleStatic)
	return securityHeaders(mux)
}

// Политика безопасности: всё своё, кроме data:/blob: для картинок и воркера; внешних скриптов нет.
const csp = "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Content-Security-Policy", csp)
		next.ServeHTTP(w, r)
	})
}

func (a *app) handlePrivacy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	if err := a.templates.ExecuteTemplate(w, "privacy.html", nil); err != nil {
		a.fail(w, err)
	}
}

// handleStatic отдаёт собранную игру: файлы с хэшем в имени (assets/) — с вечным кэшем,
// index.html — с проверкой при каждом заходе, чтобы новая версия подхватывалась сразу.
func (a *app) handleStatic(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	if name == "README.txt" || strings.HasSuffix(name, "/") {
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(a.static, name)
	if err != nil {
		if name == "index.html" {
			http.Error(w, "Клиент не собран: запустите deploy/build.sh", http.StatusServiceUnavailable)
			return
		}
		http.NotFound(w, r)
		return
	}
	switch {
	case strings.HasPrefix(name, "assets/"):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case name == "index.html":
		w.Header().Set("Cache-Control", "no-cache")
	default:
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	http.ServeContent(w, r, name, time.Time{}, strings.NewReader(string(data)))
}
