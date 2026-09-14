.PHONY: help dev dev-stop dev-status test lint \
	backend-build backend-test backend-run backend-lint backend-image backend-deploy \
	frontend-install frontend-run frontend-build frontend-build-archive frontend-test frontend-lint frontend-deploy \
	kb-build landing-deploy

.DEFAULT_GOAL := help

help: ## Show this help message
	@echo "Hearth - Development Commands"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Shared
# ======
# Resolves in order: an already-exported shell var, then root .env (same idiom as ../sentio).
PORT ?= $(or $(shell grep -s '^PORT=' .env | cut -d= -f2-),8080)
LLM_API_KEY ?= $(shell grep -s '^LLM_API_KEY=' .env | cut -d= -f2-)
EDGE_SHARED_SECRET ?= $(shell grep -s '^EDGE_SHARED_SECRET=' .env | cut -d= -f2-)
WEB_ORIGINS ?= $(or $(shell grep -s '^WEB_ORIGINS=' .env | cut -d= -f2-),http://localhost:5180)

test: backend-test frontend-test ## Run every test suite (Go + Vitest)

lint: backend-lint frontend-lint ## gofmt + go vet + Biome

# Backend
# =======
BACKEND_DIR := backend
GCP_PROJECT_ID ?= hearth-production
GCP_REGION ?= europe-west1
IMAGE_TAG ?= latest
BACKEND_IMAGE := $(GCP_REGION)-docker.pkg.dev/$(GCP_PROJECT_ID)/hearth-registry/backend:$(IMAGE_TAG)

BACKEND_LOCAL_ENV = PORT=$(PORT) LLM_API_KEY=$(LLM_API_KEY) EDGE_SHARED_SECRET=$(EDGE_SHARED_SECRET) \
	WEB_ORIGINS=$(WEB_ORIGINS) ENVIRONMENT=local

backend-build: ## Build the backend binary
	cd $(BACKEND_DIR) && go build -o bin/server ./cmd/server

backend-test: ## Run backend unit tests
	cd $(BACKEND_DIR) && go test ./...

backend-lint: ## gofmt -l + go vet
	@cd $(BACKEND_DIR) && test -z "$$(gofmt -l .)" || { gofmt -l .; echo "gofmt: files above need formatting"; exit 1; }
	cd $(BACKEND_DIR) && go vet ./...

backend-run: ## Run the backend locally in the foreground
	@echo "Starting hearth-backend on :$(PORT)  (health: http://localhost:$(PORT)/health)"
	cd $(BACKEND_DIR) && $(BACKEND_LOCAL_ENV) go run ./cmd/server

backend-image: ## Build and push the backend Docker image to Artifact Registry
	cd $(BACKEND_DIR) && docker build -t $(BACKEND_IMAGE) .
	docker push $(BACKEND_IMAGE)

backend-deploy: ## Deploy the just-pushed image to Cloud Run (terraform/ owns the service)
	gcloud run deploy hearth-backend --project=$(GCP_PROJECT_ID) --region=$(GCP_REGION) --image=$(BACKEND_IMAGE)

# Frontend
# ========
FRONTEND_DIR := frontend
PAGES_PROJECT ?= hearth-frontend

frontend-install: ## Install frontend npm dependencies
	cd $(FRONTEND_DIR) && npm install

frontend-run: ## Run the PWA locally (Vite dev server, foreground)
	cd $(FRONTEND_DIR) && npm run dev

frontend-build: ## Type-check and build the production bundle (frontend/dist/, archive template included)
	cd $(FRONTEND_DIR) && npm run build

frontend-build-archive: ## Build only the single-file portable archive template (frontend/dist-archive/)
	cd $(FRONTEND_DIR) && npm run build:archive

frontend-test: ## Run frontend unit tests (Vitest)
	cd $(FRONTEND_DIR) && npm run test

frontend-lint: ## Biome check
	cd $(FRONTEND_DIR) && npm run lint

# Deliberately manual, same split as ../sentio: Terraform owns the Pages project, this uploads.
frontend-deploy: frontend-build ## Deploy the built frontend to Cloudflare Pages
	cd $(FRONTEND_DIR) && npx wrangler pages deploy dist --project-name=$(PAGES_PROJECT) --branch=main --commit-dirty=true

# Knowledge base
# ==============
kb-build: ## Build frontend/public/kb.json from kb/reviewed/*.json
	python3 kb/build_kb.py

# Landing
# =======
LANDING_PAGES_PROJECT ?= hearth-landing

landing-deploy: ## Deploy landing/ to Cloudflare Pages (apex domain)
	npx wrangler pages deploy landing --project-name=$(LANDING_PAGES_PROJECT) --branch=main --commit-dirty=true

# Dev servers
# ===========
# Ported from ../sentio/Makefile: pidfiles under .dev/, stop by pidfile *and* by port, never touch
# a process whose cwd is another checkout.
DEV_DIR := .dev
BACKEND_PID_FILE := $(DEV_DIR)/backend.pid
FRONTEND_PID_FILE := $(DEV_DIR)/frontend.pid
BACKEND_LOG := $(DEV_DIR)/backend.log
FRONTEND_LOG := $(DEV_DIR)/frontend.log
# 5180, not Vite's 5173: ../sentio is a PWA on localhost:5173 and its service worker would serve
# sentio's cached shell instead of Hearth. Service-worker scope is per origin, so use a distinct port.
FRONTEND_PORT ?= 5180
FRONTEND_URL := http://localhost:$(FRONTEND_PORT)

define stop_service
	@pids=""; \
	if [ -f $(1) ]; then \
		p="$$(cat $(1) 2>/dev/null)"; \
		if [ -n "$$p" ] && kill -0 $$p 2>/dev/null; then pids="$$p"; fi; \
	fi; \
	for p in $$(lsof -a -u$$(id -un) -ti tcp:$(2) -sTCP:LISTEN 2>/dev/null); do \
		case " $$pids " in *" $$p "*) continue;; esac; \
		cwd="$$(readlink /proc/$$p/cwd 2>/dev/null)"; \
		if [ -n "$$cwd" ] && [ "$$cwd" != "$(CURDIR)" ] && [ "$$cwd" = "$${cwd#$(CURDIR)/}" ]; then \
			echo "$(3): PID $$p holds port $(2) but runs outside this repo ($$cwd) — leaving it alone"; \
			continue; \
		fi; \
		pids="$$pids $$p"; \
	done; \
	if [ -z "$$pids" ]; then \
		echo "$(3) not running."; \
		rm -f $(1); \
	else \
		for p in $$pids; do \
			echo "$(3): stopping PID $$p ($$(ps -o args= -p $$p 2>/dev/null | cut -c1-60))"; \
			kill -TERM $$p 2>/dev/null || true; \
		done; \
		alive="$$pids"; \
		for i in $$(seq 1 20); do \
			rem=""; \
			for p in $$alive; do if kill -0 $$p 2>/dev/null; then rem="$$rem $$p"; fi; done; \
			alive="$$rem"; \
			if [ -z "$$alive" ]; then break; fi; \
			sleep 0.5; \
		done; \
		if [ -n "$$alive" ]; then \
			echo "$(3): still alive after SIGTERM ($$alive) — sending SIGKILL"; \
			for p in $$alive; do kill -KILL $$p 2>/dev/null || true; done; \
			sleep 1; \
			rem=""; \
			for p in $$alive; do if kill -0 $$p 2>/dev/null; then rem="$$rem $$p"; fi; done; \
			alive="$$rem"; \
		fi; \
		rm -f $(1); \
		if [ -n "$$alive" ]; then echo "$(3): FAILED to stop$$alive"; exit 1; fi; \
		echo "$(3) stopped."; \
	fi
endef

define start_check
	@ok=0; \
	for i in $$(seq 1 60); do \
		if curl -sf $(2) >/dev/null 2>&1; then ok=1; break; fi; \
		if ! kill -0 $$(cat $(1)) 2>/dev/null; then break; fi; \
		sleep 0.5; \
	done; \
	if [ $$ok -ne 1 ] || ! kill -0 $$(cat $(1)) 2>/dev/null; then \
		echo ""; \
		echo "$(4) failed to start — last lines of $(3):"; \
		tail -20 $(3); \
		rm -f $(1); \
		exit 1; \
	fi
endef

dev: ## Start backend + frontend in the background and open the app (restarts if already running)
	@if [ ! -x "$(FRONTEND_DIR)/node_modules/.bin/vite" ]; then \
		echo "Error: frontend dependencies not installed — run 'make frontend-install' first"; exit 1; \
	fi
	@echo "Stopping anything already running..."
	$(call stop_service,$(BACKEND_PID_FILE),$(PORT),Backend)
	$(call stop_service,$(FRONTEND_PID_FILE),$(FRONTEND_PORT),Frontend)
	@mkdir -p $(DEV_DIR)
	@echo "Building backend..."
	@cd $(BACKEND_DIR) && go build -o bin/server ./cmd/server
	@echo "Starting backend on :$(PORT)..."
	@( cd $(BACKEND_DIR) && exec env $(BACKEND_LOCAL_ENV) ./bin/server ) > $(BACKEND_LOG) 2>&1 & echo $$! > $(BACKEND_PID_FILE)
	$(call start_check,$(BACKEND_PID_FILE),http://localhost:$(PORT)/health,$(BACKEND_LOG),Backend)
	@echo "Starting frontend on :$(FRONTEND_PORT)..."
	@( cd $(FRONTEND_DIR) && exec env HEARTH_BACKEND_PROXY_TARGET=http://localhost:$(PORT) ./node_modules/.bin/vite --port $(FRONTEND_PORT) --strictPort ) > $(FRONTEND_LOG) 2>&1 & echo $$! > $(FRONTEND_PID_FILE)
	$(call start_check,$(FRONTEND_PID_FILE),$(FRONTEND_URL),$(FRONTEND_LOG),Frontend)
	@echo ""
	@echo "Backend:  http://localhost:$(PORT)  (PID $$(cat $(BACKEND_PID_FILE)), log: $(BACKEND_LOG))"
	@echo "Frontend: $(FRONTEND_URL)  (PID $$(cat $(FRONTEND_PID_FILE)), log: $(FRONTEND_LOG))"
	@(xdg-open $(FRONTEND_URL) >/dev/null 2>&1 &) || (open $(FRONTEND_URL) >/dev/null 2>&1 &) || echo "Open $(FRONTEND_URL) in your browser."
	@echo "Run 'make dev-stop' to stop both."

dev-stop: ## Stop the backend/frontend dev servers (by pidfile and by listening port)
	$(call stop_service,$(BACKEND_PID_FILE),$(PORT),Backend)
	$(call stop_service,$(FRONTEND_PID_FILE),$(FRONTEND_PORT),Frontend)

dev-status: ## Show what the dev pidfiles claim and what actually holds the dev ports
	@printf 'Backend  (:%s)\n' "$(PORT)"
	@printf '  pidfile: %s\n' "$$(if [ -f $(BACKEND_PID_FILE) ]; then p=$$(cat $(BACKEND_PID_FILE)); if kill -0 $$p 2>/dev/null; then echo "$$p (alive)"; else echo "$$p (dead — stale)"; fi; else echo "none"; fi)"
	@printf '  port:    %s\n' "$$(lsof -a -u$$(id -un) -ti tcp:$(PORT) -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' | sed 's/ $$//;s/^$$/free/')"
	@printf 'Frontend (:%s)\n' "$(FRONTEND_PORT)"
	@printf '  pidfile: %s\n' "$$(if [ -f $(FRONTEND_PID_FILE) ]; then p=$$(cat $(FRONTEND_PID_FILE)); if kill -0 $$p 2>/dev/null; then echo "$$p (alive)"; else echo "$$p (dead — stale)"; fi; else echo "none"; fi)"
	@printf '  port:    %s\n' "$$(lsof -a -u$$(id -un) -ti tcp:$(FRONTEND_PORT) -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' | sed 's/ $$//;s/^$$/free/')"
