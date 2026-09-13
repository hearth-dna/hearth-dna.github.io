package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEdgeSecret(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })
	h := EdgeSecret("s3cret")(ok)

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("GET", "/", nil))
	if rr.Code != 403 {
		t.Fatalf("missing header: got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Hearth-Edge", "s3cret")
	h.ServeHTTP(rr, req)
	if rr.Code != 204 {
		t.Fatalf("with header: got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	EdgeSecret("")(ok).ServeHTTP(rr, httptest.NewRequest("GET", "/", nil))
	if rr.Code != 204 {
		t.Fatalf("disabled check: got %d", rr.Code)
	}
}
