package config

import "testing"

func TestLoadFailsClosedWithoutEdgeSecret(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("EDGE_SHARED_SECRET", "")
	t.Setenv("WEB_ORIGINS", "https://app.example")
	if _, err := Load(); err == nil {
		t.Fatal("expected error without EDGE_SHARED_SECRET in production")
	}
}

func TestLoadLocal(t *testing.T) {
	t.Setenv("ENVIRONMENT", "local")
	t.Setenv("WEB_ORIGINS", "http://localhost:5173, http://127.0.0.1:5173")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.WebOrigins) != 2 || cfg.Port != "8080" {
		t.Fatalf("unexpected config %+v", cfg)
	}
}
