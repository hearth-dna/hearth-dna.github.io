package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vologab/hearth/backend/internal/config"
	"github.com/vologab/hearth/backend/internal/llm"
)

func testCfg() config.Config {
	return config.Config{Port: "0", Environment: "local", WebOrigins: []string{"http://localhost:5173"}}
}

func TestHealth(t *testing.T) {
	rr := httptest.NewRecorder()
	newRouter(testCfg(), llm.New("")).ServeHTTP(rr, httptest.NewRequest("GET", "/health", nil))
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), `"ok"`) {
		t.Fatalf("health: %d %s", rr.Code, rr.Body.String())
	}
}

func TestAskWithoutKeyIs402(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/ask", strings.NewReader(`{"context":"# c","question":"q"}`))
	newRouter(testCfg(), llm.New("")).ServeHTTP(rr, req)
	if rr.Code != http.StatusPaymentRequired {
		t.Fatalf("expected 402, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestAskRejectsEmptyQuestion(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/ask", strings.NewReader(`{"context":"# c"}`))
	newRouter(testCfg(), llm.New("k")).ServeHTTP(rr, req)
	if rr.Code != 400 {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}
