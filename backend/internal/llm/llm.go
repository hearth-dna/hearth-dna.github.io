// Package llm forwards an Ask request to a chat-completions provider. It is a passthrough: the
// context pack the browser built (and the user previewed) is the only thing sent, and nothing is
// retained. The user's own key (BYOK) takes precedence over the operator key.
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	anthropicURL     = "https://api.anthropic.com/v1/messages"
	anthropicVersion = "2023-06-01"
	defaultModel     = "claude-sonnet-5"
	maxOutputTokens  = 1500
)

type Request struct {
	Context  string `json:"context"`  // the previewed context pack (Markdown)
	Question string `json:"question"` // the user's question
	Model    string `json:"model,omitempty"`
}

type Response struct {
	Answer string `json:"answer"`
	Model  string `json:"model"`
}

var ErrNoKey = errors.New("no API key: send X-Hearth-Byok or configure LLM_API_KEY")

type Client struct {
	HTTP        *http.Client
	OperatorKey string
	URL         string
}

func New(operatorKey string) *Client {
	return &Client{HTTP: &http.Client{Timeout: 60 * time.Second}, OperatorKey: operatorKey, URL: anthropicURL}
}

func (c *Client) Ask(ctx context.Context, req Request, byok string) (Response, error) {
	key := byok
	if key == "" {
		key = c.OperatorKey
	}
	if key == "" {
		return Response{}, ErrNoKey
	}
	model := req.Model
	if model == "" {
		model = defaultModel
	}
	body, _ := json.Marshal(map[string]any{
		"model":      model,
		"max_tokens": maxOutputTokens,
		"system": "You are helping a person understand their own family's genetic and health information. " +
			"Explain plainly, list uncertainties, and end with questions they could ask a clinician. " +
			"Never diagnose or prescribe. The context was assembled locally by the user and may contain errors.",
		"messages": []map[string]string{{"role": "user", "content": req.Context + "\n\n## Question\n" + req.Question}},
	})
	hr, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, bytes.NewReader(body))
	if err != nil {
		return Response{}, err
	}
	hr.Header.Set("content-type", "application/json")
	hr.Header.Set("x-api-key", key)
	hr.Header.Set("anthropic-version", anthropicVersion)
	resp, err := c.HTTP.Do(hr)
	if err != nil {
		return Response{}, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return Response{}, err
	}
	if resp.StatusCode/100 != 2 {
		return Response{}, fmt.Errorf("provider returned %d", resp.StatusCode)
	}
	var parsed struct {
		Model   string `json:"model"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return Response{}, err
	}
	out := Response{Model: parsed.Model}
	for _, c := range parsed.Content {
		if c.Type == "text" {
			out.Answer += c.Text
		}
	}
	return out, nil
}
