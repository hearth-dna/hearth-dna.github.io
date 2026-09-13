# backend/ — stateless helper service

Go 1.25, chi. **No database, ever.** Endpoints: `GET /health`, `POST /v1/ask` (Anthropic Messages
passthrough; user's key in `X-Hearth-Byok` beats `LLM_API_KEY`). Middleware order: metadata-only
logger → CORS → edge shared secret → 256 KB body cap. Never log a request body, header or query
string. `ENVIRONMENT=local` is the only mode that runs without `EDGE_SHARED_SECRET`.

The source is open-source ready: no secret, hostname, origin URL or key may be hardcoded — every
such value comes from the environment, and an attacker reading this code must learn nothing that
weakens the edge secret, CORS or body-cap checks. Error responses stay generic (no internals).

```bash
make backend-run   # foreground, reads .env
make backend-test
```
