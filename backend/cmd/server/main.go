// Command server runs the Hearth helper backend: stateless, no database, no body logging.
// The PWA works without it (docs/design.md §11); it exists for the opt-in Ask tier 3 proxy.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"

	"github.com/vologab/hearth/backend/internal/config"
	"github.com/vologab/hearth/backend/internal/llm"
	"github.com/vologab/hearth/backend/internal/middleware"
)

var version = "dev"

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	r := newRouter(cfg, llm.New(cfg.LLMAPIKey))

	srv := &http.Server{Addr: ":" + cfg.Port, Handler: r, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Printf("hearth-backend %s listening on :%s (env=%s)", version, cfg.Port, cfg.Environment)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func newRouter(cfg config.Config, ask *llm.Client) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.MetadataLogger)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.WebOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "X-Hearth-Byok", "X-Hearth-Edge"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": version})
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.EdgeSecret(cfg.EdgeSharedSecret))
		r.Use(middleware.MaxBytes(256 << 10)) // a context pack is a few KB; 256 KB is generous
		r.Post("/v1/ask", func(w http.ResponseWriter, req *http.Request) {
			var in llm.Request
			if err := json.NewDecoder(req.Body).Decode(&in); err != nil || in.Question == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "context and question required"})
				return
			}
			out, err := ask.Ask(req.Context(), in, req.Header.Get("X-Hearth-Byok"))
			switch {
			case errors.Is(err, llm.ErrNoKey):
				writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": err.Error()})
			case err != nil:
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "provider error"})
			default:
				writeJSON(w, http.StatusOK, out)
			}
		})
	})
	return r
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
