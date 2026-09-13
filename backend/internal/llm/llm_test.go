package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAskPrefersByokAndParsesText(t *testing.T) {
	var seenKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenKey = r.Header.Get("x-api-key")
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != defaultModel {
			t.Errorf("model = %v", body["model"])
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   "claude-sonnet-5",
			"content": []map[string]string{{"type": "text", "text": "hello"}},
		})
	}))
	defer srv.Close()

	c := New("operator")
	c.URL = srv.URL
	res, err := c.Ask(context.Background(), Request{Context: "# ctx", Question: "q"}, "user-key")
	if err != nil {
		t.Fatal(err)
	}
	if seenKey != "user-key" || res.Answer != "hello" {
		t.Fatalf("seenKey=%q answer=%q", seenKey, res.Answer)
	}
}

func TestAskWithoutAnyKey(t *testing.T) {
	c := New("")
	if _, err := c.Ask(context.Background(), Request{}, ""); err != ErrNoKey {
		t.Fatalf("expected ErrNoKey, got %v", err)
	}
}
