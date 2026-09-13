// Package middleware holds the three guards every helper endpoint runs behind: a body-size cap, the
// edge shared-secret check, and a logger that records status and latency but never a body, header
// or query string (docs/design.md §11.3).
package middleware

import (
	"crypto/subtle"
	"log"
	"net/http"
	"time"
)

func MaxBytes(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, n)
			next.ServeHTTP(w, r)
		})
	}
}

// EdgeSecret rejects requests that did not come through the Cloudflare Worker. An empty secret
// (local dev) disables the check.
func EdgeSecret(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if secret == "" {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got := r.Header.Get("X-Hearth-Edge")
			if subtle.ConstantTimeCompare([]byte(got), []byte(secret)) != 1 {
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) { s.status = code; s.ResponseWriter.WriteHeader(code) }

// MetadataLogger logs method, path, status and duration only.
func MetadataLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(sw, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, sw.status, time.Since(start).Round(time.Millisecond))
	})
}
