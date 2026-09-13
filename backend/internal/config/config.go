// Package config loads the backend's environment. The backend is a stateless helper (docs/design.md
// §11): it has no database, and nothing here may ever point at one.
package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	Port             string
	Environment      string   // "local" or "production"
	LLMAPIKey        string   // optional operator key; BYOK still works without it
	EdgeSharedSecret string   // set by the Cloudflare Worker; required in production
	WebOrigins       []string // CORS allow-list
}

func Load() (Config, error) {
	cfg := Config{
		Port:             getenv("PORT", "8080"),
		Environment:      getenv("ENVIRONMENT", "production"),
		LLMAPIKey:        strings.TrimSpace(os.Getenv("LLM_API_KEY")),
		EdgeSharedSecret: strings.TrimSpace(os.Getenv("EDGE_SHARED_SECRET")),
	}
	for _, o := range strings.Split(os.Getenv("WEB_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			cfg.WebOrigins = append(cfg.WebOrigins, o)
		}
	}
	if cfg.Environment != "local" && cfg.EdgeSharedSecret == "" {
		// Fail closed: without the edge secret the raw *.run.app URL could drain the free LLM quota.
		return cfg, fmt.Errorf("EDGE_SHARED_SECRET is required outside ENVIRONMENT=local")
	}
	if len(cfg.WebOrigins) == 0 {
		return cfg, fmt.Errorf("WEB_ORIGINS is required")
	}
	return cfg, nil
}

func getenv(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}
