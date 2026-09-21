.PHONY: help dev dev-stop dev-status test lint \
	frontend-install frontend-run frontend-build frontend-build-archive frontend-build-pages \
	frontend-preview-pages frontend-test frontend-lint pages-deploy \
	kb-build \
	mobile-web android android-build android-install android-test android-lint android-logs android-clean \
	android-keystore android-bundle android-verify android-publish _android-release-ready \
	ios ios-generate ios-build ios-test ios-clean ios-archive ios-ipa ios-verify ios-testflight \
	ios-testflight-status _ios-release-ready \
	mobile-secrets

.DEFAULT_GOAL := help

help: ## Show this help message
	@echo "Hearth - Development Commands"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Shared
# ======
# Values resolve in order: an already-exported shell var, then root .env (same idiom as ../sentio).

test: frontend-test ## Run every test suite (Vitest)

lint: frontend-lint ## Biome check

# Frontend
# ========
FRONTEND_DIR := frontend

frontend-install: ## Install frontend npm dependencies
	cd $(FRONTEND_DIR) && npm install

frontend-run: ## Run the PWA locally (Vite dev server, foreground)
	cd $(FRONTEND_DIR) && npm run dev

frontend-build: ## Type-check and build the production bundle (frontend/dist/, archive template included)
	cd $(FRONTEND_DIR) && npm run build

frontend-build-archive: ## Build only the single-file portable archive template (frontend/dist-archive/)
	cd $(FRONTEND_DIR) && npm run build:archive

frontend-build-pages: ## Build the GitHub Pages bundle (adds the 404.html SPA fallback)
	cd $(FRONTEND_DIR) && npm run build:pages

frontend-preview-pages: frontend-build-pages ## Serve the GitHub Pages build locally on :5181
	cd $(FRONTEND_DIR) && npx vite preview --port 5181

frontend-test: ## Run frontend unit tests (Vitest)
	cd $(FRONTEND_DIR) && npm run test

frontend-lint: ## Biome check
	cd $(FRONTEND_DIR) && npm run lint

# Publishing runs in Actions: actions/deploy-pages needs the workflow's OIDC token, so there is no
# local equivalent. This only presses the button.
pages-deploy: ## Trigger the GitHub Pages deploy workflow
	gh workflow run pages.yml

# Knowledge base
# ==============
kb-build: ## Build frontend/public/kb.json from kb/reviewed/*.json
	python3 kb/build_kb.py

# Mobile shells
# =============
# Both apps are the same PWA in a native window, not a port: one WebView on Android, one WKWebView
# on iOS, each serving `frontend/dist/` from inside the app over a real origin
# (docs/decisions/0006-native-shells-around-the-pwa.md). So the web build is the step neither can
# skip, and `mobile-web` is a prerequisite of every build target below.
MOBILE_DIR := mobile
ANDROID_DIR := $(MOBILE_DIR)/android
IOS_DIR := $(MOBILE_DIR)/ios
ANDROID_WEB := $(ANDROID_DIR)/app/src/main/assets/web
IOS_WEB := $(IOS_DIR)/Hearth/Web
# Android Studio's bundled JDK, the same default as ../sentio. Override on a machine that keeps
# its JDK elsewhere: `make android ANDROID_JAVA_HOME=/path/to/jdk`.
ANDROID_JAVA_HOME ?= $(HOME)/tools/mobile/android-studio/jbr
# The SDK, passed as an environment variable rather than through a local.properties file: that file
# is machine-specific and would either be committed (wrong) or missing on a clean checkout (broken).
ANDROID_SDK_HOME ?= $(HOME)/Android/Sdk
GRADLE = JAVA_HOME=$(ANDROID_JAVA_HOME) ANDROID_HOME=$(ANDROID_SDK_HOME) ./gradlew

# Publishing inputs. Every one of them resolves from an exported shell variable first, then the
# gitignored root .env — never from a committed file (docs/runbook/store-release.md). The apps
# build and run without any of them; only the store targets require them, and they say which one
# is missing rather than failing inside Gradle or fastlane.
HEARTH_APPLICATION_ID ?= $(shell grep -s '^HEARTH_APPLICATION_ID=' .env | cut -d= -f2-)
# The committed placeholder, used for every debug build. `.example` is the reserved TLD.
ANDROID_APP_ID := $(or $(HEARTH_APPLICATION_ID),example.hearth.app)
ANDROID_KEYSTORE_PATH ?= $(or $(shell grep -s '^ANDROID_KEYSTORE_PATH=' .env | cut -d= -f2-),$(HOME)/.hearth/hearth-upload.jks)
ANDROID_KEYSTORE_PASSWORD ?= $(shell grep -s '^ANDROID_KEYSTORE_PASSWORD=' .env | cut -d= -f2-)
ANDROID_KEY_ALIAS ?= $(or $(shell grep -s '^ANDROID_KEY_ALIAS=' .env | cut -d= -f2-),upload)
ANDROID_KEY_PASSWORD ?= $(or $(shell grep -s '^ANDROID_KEY_PASSWORD=' .env | cut -d= -f2-),$(ANDROID_KEYSTORE_PASSWORD))
PLAY_SERVICE_ACCOUNT_JSON ?= $(shell grep -s '^PLAY_SERVICE_ACCOUNT_JSON=' .env | cut -d= -f2-)
APPLE_TEAM_ID ?= $(shell grep -s '^APPLE_TEAM_ID=' .env | cut -d= -f2-)
ASC_KEY_ID ?= $(shell grep -s '^ASC_KEY_ID=' .env | cut -d= -f2-)
ASC_ISSUER_ID ?= $(shell grep -s '^ASC_ISSUER_ID=' .env | cut -d= -f2-)
ASC_KEY_PATH ?= $(shell grep -s '^ASC_KEY_PATH=' .env | cut -d= -f2-)

# Passed through the environment rather than as -P flags: a `-PRELEASE_KEYSTORE_PASSWORD=...` is
# visible to every process on the machine in `ps`, while /proc/<pid>/environ is readable only by
# its owner.
ANDROID_RELEASE_ENV = HEARTH_APPLICATION_ID=$(ANDROID_APP_ID) \
	RELEASE_KEYSTORE_PATH=$(ANDROID_KEYSTORE_PATH) \
	RELEASE_KEYSTORE_PASSWORD=$(ANDROID_KEYSTORE_PASSWORD) \
	RELEASE_KEY_ALIAS=$(ANDROID_KEY_ALIAS) \
	RELEASE_KEY_PASSWORD=$(ANDROID_KEY_PASSWORD)

# adb refuses to guess when more than one transport is attached, and an emulator that died leaves an
# `offline` one behind that still counts. Pick the single device that is actually online, or the one
# named by ANDROID_SERIAL, and export it so every adb call in the recipe goes to the same device.
define adb_device
	set -- $${ANDROID_SERIAL:-$$(adb devices | awk 'NR > 1 && $$2 == "device" { print $$1 }')}; \
	if [ $$# -eq 0 ]; then echo "Error: no device — connect one and enable USB debugging"; exit 1; fi; \
	if [ $$# -gt 1 ]; then echo "Error: $$# devices online ($$*) — choose one with ANDROID_SERIAL=<serial>"; exit 1; fi; \
	export ANDROID_SERIAL=$$1
endef

define require_var
	@if [ -z "$(2)" ]; then \
		echo "Error: $(1) is not set — see docs/runbook/store-release.md"; exit 1; \
	fi
endef

mobile-web: frontend-build ## Build the PWA and copy it into both app bundles
	@rm -rf $(ANDROID_WEB) $(IOS_WEB)
	@mkdir -p $(ANDROID_WEB) $(IOS_WEB)
	@cp -R $(FRONTEND_DIR)/dist/. $(ANDROID_WEB)/
	@cp -R $(FRONTEND_DIR)/dist/. $(IOS_WEB)/
	@echo "Web build copied into $(ANDROID_WEB) and $(IOS_WEB)"

android: android-install ## Alias for android-install

android-build: mobile-web ## Build the debug APK without installing
	cd $(ANDROID_DIR) && HEARTH_APPLICATION_ID=$(ANDROID_APP_ID) $(GRADLE) :app:assembleDebug
	@echo "APK: $(ANDROID_DIR)/app/build/outputs/apk/debug/app-debug.apk"

android-install: android-build ## Build and install the debug app on a connected device (ANDROID_SERIAL= picks one of several)
	@$(adb_device); \
	echo "Installing on $$ANDROID_SERIAL"; \
	adb install -r $(ANDROID_DIR)/app/build/outputs/apk/debug/app-debug.apk && \
	{ adb shell monkey -p $(ANDROID_APP_ID).debug -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || \
	  { echo "Error: installed, but could not launch $(ANDROID_APP_ID).debug"; exit 1; }; }

android-test: ## Run the shell's unit tests (JVM, no device, no web build needed)
	cd $(ANDROID_DIR) && $(GRADLE) :app:testDebugUnitTest

android-lint: ## Run Android Lint on the shell
	cd $(ANDROID_DIR) && $(GRADLE) :app:lintDebug

android-logs: ## Follow the app's logs (requires a connected device)
	@$(adb_device); \
	adb logcat --pid=$$(adb shell pidof -s $(ANDROID_APP_ID).debug)

android-clean: ## Clean Android build artifacts and the copied web build
	cd $(ANDROID_DIR) && $(GRADLE) clean
	rm -rf $(ANDROID_WEB)

# The iOS targets need macOS and Xcode; on Linux they say so instead of failing obscurely.
define require_macos
	@if [ "$$(uname -s)" != "Darwin" ]; then echo "Error: $(1) needs macOS with Xcode"; exit 1; fi
endef

ios: ios-build ## Alias for ios-build

ios-generate: ## Regenerate mobile/ios/Hearth.xcodeproj from project.yml (macOS)
	$(call require_macos,ios-generate)
	@command -v xcodegen >/dev/null 2>&1 || { echo "Error: xcodegen not found (brew install xcodegen)"; exit 1; }
	cd $(IOS_DIR) && xcodegen generate

ios-build: mobile-web ios-generate ## Build and run the app on a simulator (macOS)
	$(call require_macos,ios-build)
	xcodebuild build -project $(IOS_DIR)/Hearth.xcodeproj -scheme Hearth \
		-destination "platform=iOS Simulator,name=iPhone 16" -quiet

ios-test: ios-generate ## Run the iOS unit tests on a simulator (macOS)
	$(call require_macos,ios-test)
	xcodebuild test -project $(IOS_DIR)/Hearth.xcodeproj -scheme Hearth \
		-destination "platform=iOS Simulator,name=iPhone 16" -quiet

ios-clean: ## Clean iOS build artifacts and the copied web build
	rm -rf $(IOS_DIR)/Hearth.xcodeproj $(IOS_DIR)/build $(IOS_WEB)

# Store releases
# --------------
# The flow is: keystore once, then bundle -> verify -> publish per release. Everything these need
# is listed by `make mobile-secrets`, and the runbook is docs/runbook/store-release.md.
ANDROID_AAB := $(ANDROID_DIR)/app/build/outputs/bundle/release/app-release.aab
# From the JDK, not the PATH: a machine with the Android toolchain need not have a system JDK, and
# `keytool: not found` is a poor way to learn that.
KEYTOOL := $(ANDROID_JAVA_HOME)/bin/keytool
# `:env` rather than a literal argument, for both tools: a password on a command line is visible to
# every process on the machine through `ps`.

android-keystore: ## Create the Play upload keystore (once, outside the repo)
	$(call require_var,ANDROID_KEYSTORE_PASSWORD,$(ANDROID_KEYSTORE_PASSWORD))
	@if [ -f "$(ANDROID_KEYSTORE_PATH)" ]; then \
		echo "Error: $(ANDROID_KEYSTORE_PATH) already exists — refusing to overwrite it."; \
		echo "Losing this file means never being able to update the published app again."; exit 1; \
	fi
	@mkdir -p "$$(dirname $(ANDROID_KEYSTORE_PATH))"
	@test -x "$(KEYTOOL)" || { echo "Error: no keytool at $(KEYTOOL) — set ANDROID_JAVA_HOME"; exit 1; }
	@KS_PASS="$(ANDROID_KEYSTORE_PASSWORD)" KEY_PASS="$(ANDROID_KEY_PASSWORD)" \
		"$(KEYTOOL)" -genkeypair -v -keystore "$(ANDROID_KEYSTORE_PATH)" -alias "$(ANDROID_KEY_ALIAS)" \
		-keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Hearth upload key" \
		-storepass:env KS_PASS -keypass:env KEY_PASS
	@chmod 600 "$(ANDROID_KEYSTORE_PATH)"
	@echo ""
	@echo "Created $(ANDROID_KEYSTORE_PATH)."
	@echo "Back it up somewhere you will still have in ten years: without it the published app"
	@echo "can never be updated, only replaced by a new listing."

# The credentials are checked before `mobile-web` rather than after it, so a missing variable costs
# a message instead of a full Vite build.
_android-release-ready:
	$(call require_var,HEARTH_APPLICATION_ID,$(HEARTH_APPLICATION_ID))
	$(call require_var,ANDROID_KEYSTORE_PASSWORD,$(ANDROID_KEYSTORE_PASSWORD))
	@test -f "$(ANDROID_KEYSTORE_PATH)" || { echo "Error: no keystore at $(ANDROID_KEYSTORE_PATH) — run 'make android-keystore'"; exit 1; }

android-bundle: _android-release-ready mobile-web ## Build the signed release AAB for Play
	cd $(ANDROID_DIR) && $(ANDROID_RELEASE_ENV) $(GRADLE) :app:bundleRelease
	@$(MAKE) android-verify

android-verify: ## Check the built AAB before it goes anywhere near Play
	@test -f "$(ANDROID_AAB)" || { echo "Error: no AAB at $(ANDROID_AAB) — run 'make android-bundle'"; exit 1; }
	@case "$(ANDROID_APP_ID)" in example.*) \
		echo "Error: the placeholder id $(ANDROID_APP_ID) is still in use. Set HEARTH_APPLICATION_ID."; exit 1;; esac
	@# Read the id out of the artifact rather than trusting the variable: a stale AAB from an
	@# earlier build would otherwise pass this check and be uploaded to the wrong listing.
	@# The manifest inside an AAB is protobuf, so the id is read as a string: it appears as the
	@# start of its own entry, followed by a length byte rather than by more of the name.
	@id_re=$$(printf '%s' "$(ANDROID_APP_ID)" | sed 's/[.]/\\./g'); \
		unzip -p "$(ANDROID_AAB)" base/manifest/AndroidManifest.xml | strings \
		| grep -qE "^$$id_re([^A-Za-z0-9._]|$$)" \
		|| { echo "Error: $(ANDROID_AAB) does not carry $(ANDROID_APP_ID) — rebuild with 'make android-bundle'"; exit 1; }
	@$(ANDROID_JAVA_HOME)/bin/jarsigner -verify "$(ANDROID_AAB)" >/dev/null \
		|| { echo "Error: $(ANDROID_AAB) is not signed"; exit 1; }
	@echo "$(ANDROID_AAB)"
	@echo "  id:      $(ANDROID_APP_ID)"
	@echo "  version: $$(grep '^VERSION_NAME=' $(ANDROID_DIR)/version.properties | cut -d= -f2) ($$(grep '^VERSION_CODE=' $(ANDROID_DIR)/version.properties | cut -d= -f2))"
	@echo "  signed:  yes"

# TRACK=internal|alpha|beta|production, ROLLOUT=0.1 stages a production release.
android-publish: ## Upload the AAB to Play (TRACK=internal by default)
	$(call require_var,HEARTH_APPLICATION_ID,$(HEARTH_APPLICATION_ID))
	$(call require_var,PLAY_SERVICE_ACCOUNT_JSON,$(PLAY_SERVICE_ACCOUNT_JSON))
	@$(MAKE) android-verify
	cd $(MOBILE_DIR) && HEARTH_APPLICATION_ID=$(ANDROID_APP_ID) \
		SUPPLY_JSON_KEY=$(PLAY_SERVICE_ACCOUNT_JSON) \
		bundle exec fastlane android upload \
		aab:../$(ANDROID_AAB) track:$(or $(TRACK),internal) $(if $(ROLLOUT),rollout:$(ROLLOUT),)

IOS_ARCHIVE := $(IOS_DIR)/build/Hearth.xcarchive
IOS_IPA_DIR := $(IOS_DIR)/build/ipa
IOS_IPA := $(IOS_IPA_DIR)/Hearth.ipa

IOS_ASC_ENV = HEARTH_APPLICATION_ID=$(HEARTH_APPLICATION_ID) \
	ASC_KEY_ID=$(ASC_KEY_ID) ASC_ISSUER_ID=$(ASC_ISSUER_ID) ASC_KEY_PATH=$(ASC_KEY_PATH)

# Lets xcodebuild create the distribution profile itself on a machine that has never signed this
# app — a fresh CI runner, or your Mac the first time. Without a key it falls back to whatever
# Xcode has cached, which is nothing on a runner.
IOS_AUTH_ARGS = $(if $(ASC_KEY_PATH),-authenticationKeyPath "$(abspath $(ASC_KEY_PATH))" \
	-authenticationKeyID $(ASC_KEY_ID) -authenticationKeyIssuerID $(ASC_ISSUER_ID),)

# Credentials are checked before `mobile-web`, so a missing variable costs a message rather than a
# full Vite build and an Xcode archive. Mirrors _android-release-ready.
_ios-release-ready:
	$(call require_macos,ios release)
	$(call require_var,HEARTH_APPLICATION_ID,$(HEARTH_APPLICATION_ID))
	$(call require_var,APPLE_TEAM_ID,$(APPLE_TEAM_ID))
	@case "$(HEARTH_APPLICATION_ID)" in example.*) \
		echo "Error: the placeholder id $(HEARTH_APPLICATION_ID) cannot be published. Set HEARTH_APPLICATION_ID."; exit 1;; esac

ios-archive: _ios-release-ready mobile-web ios-generate ## Archive the app for distribution (macOS)
	xcodebuild archive -project $(IOS_DIR)/Hearth.xcodeproj -scheme Hearth \
		-destination "generic/platform=iOS" -archivePath $(IOS_ARCHIVE) \
		PRODUCT_BUNDLE_IDENTIFIER=$(HEARTH_APPLICATION_ID) DEVELOPMENT_TEAM=$(APPLE_TEAM_ID) \
		$(IOS_AUTH_ARGS) -allowProvisioningUpdates

# ExportOptions.plist is written here, not committed: its teamID is an account identifier.
ios-ipa: ios-archive ## Export a signed .ipa from the archive, then verify it (macOS)
	@sed 's/__TEAM_ID__/$(APPLE_TEAM_ID)/' $(IOS_DIR)/ExportOptions.plist.example > $(IOS_DIR)/ExportOptions.plist
	xcodebuild -exportArchive -archivePath $(IOS_ARCHIVE) \
		-exportOptionsPlist $(IOS_DIR)/ExportOptions.plist -exportPath $(IOS_IPA_DIR) \
		$(IOS_AUTH_ARGS) -allowProvisioningUpdates
	@$(MAKE) ios-verify

ios-verify: ## Check the built .ipa before it goes anywhere near App Store Connect (macOS)
	$(call require_macos,ios-verify)
	@test -f "$(IOS_IPA)" || { echo "Error: no .ipa at $(IOS_IPA) — run 'make ios-ipa'"; exit 1; }
	@work=$$(mktemp -d); trap 'rm -rf "$$work"' EXIT; \
		unzip -q -o "$(IOS_IPA)" -d "$$work" || { echo "Error: $(IOS_IPA) is not a readable .ipa"; exit 1; }; \
		app=$$(ls -d "$$work"/Payload/*.app 2>/dev/null | head -1); \
		test -n "$$app" || { echo "Error: no Payload/*.app inside $(IOS_IPA)"; exit 1; }; \
		id=$$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$$app/Info.plist"); \
		version=$$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$$app/Info.plist"); \
		build=$$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$$app/Info.plist"); \
		compliance=$$(/usr/libexec/PlistBuddy -c "Print :ITSAppUsesNonExemptEncryption" "$$app/Info.plist" 2>/dev/null || echo missing); \
		: "read from the artifact, not from the variable: a stale .ipa from an earlier build would"; \
		: "otherwise pass and be uploaded to the wrong listing"; \
		test "$$id" = "$(HEARTH_APPLICATION_ID)" \
			|| { echo "Error: $(IOS_IPA) carries $$id, not $(HEARTH_APPLICATION_ID) — rebuild with 'make ios-ipa'"; exit 1; }; \
		: "a build with no web app in it installs, launches and shows the cannot-start screen"; \
		test -f "$$app/Web/index.html" \
			|| { echo "Error: no web app inside the bundle — 'make mobile-web' did not run"; exit 1; }; \
		test -f "$$app/PrivacyInfo.xcprivacy" \
			|| { echo "Error: PrivacyInfo.xcprivacy is missing — the upload would be rejected by email hours later (ITMS-91053)"; exit 1; }; \
		: "without this key every TestFlight build waits on the export-compliance questionnaire"; \
		test "$$compliance" = "false" \
			|| { echo "Error: ITSAppUsesNonExemptEncryption is $$compliance, expected false"; exit 1; }; \
		codesign --verify --deep --strict "$$app" \
			|| { echo "Error: $$app is not validly signed"; exit 1; }; \
		test -f "$$app/embedded.mobileprovision" \
			|| { echo "Error: no provisioning profile in the bundle"; exit 1; }; \
		echo "$(IOS_IPA)"; \
		echo "  id:      $$id"; \
		echo "  version: $$version ($$build)"; \
		echo "  signed:  yes"; \
		echo "  web app: bundled"

ios-testflight: ## Upload the verified .ipa to TestFlight (macOS)
	$(call require_macos,ios-testflight)
	$(call require_var,ASC_KEY_ID,$(ASC_KEY_ID))
	$(call require_var,ASC_ISSUER_ID,$(ASC_ISSUER_ID))
	$(call require_var,ASC_KEY_PATH,$(ASC_KEY_PATH))
	@$(MAKE) ios-verify
	cd $(MOBILE_DIR) && $(IOS_ASC_ENV) \
		bundle exec fastlane ios upload_build ipa:../$(IOS_IPA) $(if $(NOTES),changelog:"$(NOTES)",)

ios-testflight-status: ## Show the newest build App Store Connect has for this app
	$(call require_var,ASC_KEY_ID,$(ASC_KEY_ID))
	$(call require_var,ASC_ISSUER_ID,$(ASC_ISSUER_ID))
	$(call require_var,ASC_KEY_PATH,$(ASC_KEY_PATH))
	cd $(MOBILE_DIR) && $(IOS_ASC_ENV) bundle exec fastlane ios status

mobile-secrets: ## Show which publishing inputs are set (names and status only, never values)
	@echo "Publishing inputs (docs/runbook/store-release.md). Values live in .env, never in git."
	@printf '  %-28s %s\n' "HEARTH_APPLICATION_ID" "$(if $(HEARTH_APPLICATION_ID),set,MISSING - using placeholder $(ANDROID_APP_ID))"
	@printf '  %-28s %s\n' "ANDROID_KEYSTORE_PATH" "$(if $(wildcard $(ANDROID_KEYSTORE_PATH)),found at $(ANDROID_KEYSTORE_PATH),MISSING - run make android-keystore)"
	@printf '  %-28s %s\n' "ANDROID_KEYSTORE_PASSWORD" "$(if $(ANDROID_KEYSTORE_PASSWORD),set,MISSING)"
	@printf '  %-28s %s\n' "ANDROID_KEY_ALIAS" "$(ANDROID_KEY_ALIAS)"
	@printf '  %-28s %s\n' "PLAY_SERVICE_ACCOUNT_JSON" "$(if $(wildcard $(PLAY_SERVICE_ACCOUNT_JSON)),found,MISSING - Play uploads unavailable)"
	@printf '  %-28s %s\n' "APPLE_TEAM_ID" "$(if $(APPLE_TEAM_ID),set,MISSING)"
	@printf '  %-28s %s\n' "ASC_KEY_ID" "$(if $(ASC_KEY_ID),set,MISSING)"
	@printf '  %-28s %s\n' "ASC_ISSUER_ID" "$(if $(ASC_ISSUER_ID),set,MISSING)"
	@printf '  %-28s %s\n' "ASC_KEY_PATH" "$(if $(wildcard $(ASC_KEY_PATH)),found,MISSING - TestFlight uploads unavailable)"

# Dev servers
# ===========
# Ported from ../sentio/Makefile: pidfiles under .dev/, stop by pidfile *and* by port, never touch
# a process whose cwd is another checkout.
DEV_DIR := .dev
FRONTEND_PID_FILE := $(DEV_DIR)/frontend.pid
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

dev: ## Start the frontend in the background and open the app (restarts if already running)
	@if [ ! -x "$(FRONTEND_DIR)/node_modules/.bin/vite" ]; then \
		echo "Error: frontend dependencies not installed — run 'make frontend-install' first"; exit 1; \
	fi
	@echo "Stopping anything already running..."
	$(call stop_service,$(FRONTEND_PID_FILE),$(FRONTEND_PORT),Frontend)
	@mkdir -p $(DEV_DIR)
	@echo "Starting frontend on :$(FRONTEND_PORT)..."
	@( cd $(FRONTEND_DIR) && exec ./node_modules/.bin/vite --port $(FRONTEND_PORT) --strictPort ) > $(FRONTEND_LOG) 2>&1 & echo $$! > $(FRONTEND_PID_FILE)
	$(call start_check,$(FRONTEND_PID_FILE),$(FRONTEND_URL),$(FRONTEND_LOG),Frontend)
	@echo ""
	@echo "Frontend: $(FRONTEND_URL)  (PID $$(cat $(FRONTEND_PID_FILE)), log: $(FRONTEND_LOG))"
	@(xdg-open $(FRONTEND_URL) >/dev/null 2>&1 &) || (open $(FRONTEND_URL) >/dev/null 2>&1 &) || echo "Open $(FRONTEND_URL) in your browser."
	@echo "Run 'make dev-stop' to stop both."

dev-stop: ## Stop the frontend dev server (by pidfile and by listening port)
	$(call stop_service,$(FRONTEND_PID_FILE),$(FRONTEND_PORT),Frontend)

dev-status: ## Show what the dev pidfile claims and what actually holds the dev port
	@printf 'Frontend (:%s)\n' "$(FRONTEND_PORT)"
	@printf '  pidfile: %s\n' "$$(if [ -f $(FRONTEND_PID_FILE) ]; then p=$$(cat $(FRONTEND_PID_FILE)); if kill -0 $$p 2>/dev/null; then echo "$$p (alive)"; else echo "$$p (dead — stale)"; fi; else echo "none"; fi)"
	@printf '  port:    %s\n' "$$(lsof -a -u$$(id -un) -ti tcp:$(FRONTEND_PORT) -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' | sed 's/ $$//;s/^$$/free/')"
