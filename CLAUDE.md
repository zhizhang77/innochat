# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A standalone C++ proxy server that forwards OpenAI-compatible chat completion requests to external APIs. It embeds a Svelte 5 web UI (hash-routed SPA) compiled into the binary as static assets. The proxy handles both streaming (SSE) and non-streaming completions, with clients authenticating via `X-Proxy-API-Key` and `X-Proxy-Base-URL` headers.

## Build & run

### C++ server

```bash
# Configure (from repo root — use MinGW Makefiles if Ninja is unavailable)
cmake -B build -G "MinGW Makefiles"

# Build
cmake --build build

# Run
./build/innochat --port 8080
```

**CMake options:**
- `PROXY_WITH_UI` (ON by default) — embeds UI assets into the binary
- `PROXY_WITH_HTTPS` (OFF by default) — builds with BoringSSL for HTTPS upstream support

**Asset embedding flow:** CMake auto-detects npm. If available, it runs `npm install && npm run build` in `ui/` and copies `ui/dist/` → `ui-assets/`. Otherwise it falls back to pre-built assets already in `ui-assets/`. The `generate_assets_header()` function in CMakeLists.txt hex-encodes `ui-assets/` files into `build/assets.h` as `unsigned char` arrays.

CMake's `execute_process` for npm may fail even when manual npm commands succeed (shell/env differences). In that case, build the UI manually first:

```bash
cd ui
npm install
npm run build
cp dist/* ../ui-assets/
```

### Web UI

```bash
cd ui

# Dev server (proxies /v1, /props, /models to localhost:8080 — requires proxy server running)
npm run dev

# Build (outputs to ui/dist/)
npm run build

# Lint & type-check
npm run lint
npm run check

# Tests
npm run test:unit -- --run       # Node-based unit tests
npm run test:client -- --run     # Browser-based component tests (Chromium)
npm run test:ui -- --run         # Storybook-based visual tests
npm run test:e2e                 # Playwright E2E tests
```

## Architecture

### C++ backend (`main.cpp`, `CMakeLists.txt`)

The entire server is a single file. It uses vendored `cpp-httplib` for HTTP.

- **`POST /proxy/chat/completions`** — the core endpoint. Reads `X-Proxy-Base-URL` and `X-Proxy-API-Key` headers from the client, forwards the request body upstream. Detects streaming mode by inspecting the JSON body for `"stream":true`, then uses a thread-pipe pattern (thread-safe queue with condition variable) to relay SSE chunks back via chunked transfer encoding
- **`GET /health`** — `{"status":"ok"}`
- **`GET /props`** — minimal server info so the UI initializes (reports role as `"router"`)
- **`GET /models`** / **`GET /v1/models`** — empty model list (external models are configured client-side)
- **Embedded UI** — serves `index.html`, `bundle.js`, `bundle.css` from compiled-in byte arrays. `index.html` gets COOP/COEP isolation headers for SharedArrayBuffer support
- **CORS** — `set_pre_routing_handler` returns permissive CORS headers for all origins, handles OPTIONS pre-flight

### Web UI (`ui/`)

- **Framework:** Svelte 5 (runes mode) + SvelteKit with `@sveltejs/adapter-static`
- **Routing:** hash-based (`router: { type: 'hash' }`) with relative paths — required because the SPA is served from a C++ binary with no server-side fallback routing
- **Output:** single-bundle strategy (`bundleStrategy: 'single'`) produces `bundle.js`, `bundle.css`, `index.html`; dev-to-prod build is then post-processed to inline favicon and flatten structure for embedding
- **Styling:** Tailwind CSS 4 + `tailwind-variants` + `tailwind-merge`; shadcn-svelte component library (bits-ui primitives); `mode-watcher` for light/dark theme
- **State management:** Svelte 5 runes-based stores under `src/stores/` (`.svelte.ts` files). Key stores: `chat`, `conversations`, `models`, `mcp`, `settings`, `server`
- **Persistence:** IndexedDB via Dexie.js (`src/services/database.service.ts`) with migrations in `migration.service.ts`
- **MCP:** Model Context Protocol support via `@modelcontextprotocol/sdk` for connecting to external MCP servers (tools, resources, prompts)
- **Testing:** Vitest with three projects — `unit` (node), `client` (browser via Playwright), `ui` (Storybook-based). Storybook stories live alongside components. E2E tests use Playwright directly

### Important: `$lib` alias configuration

The codebase imports from `$lib/components/...`, `$lib/constants`, `$lib/stores/...` etc. SvelteKit's default `$lib` points to `src/lib`, but all source files live directly under `src/`. Two things make this work:

1. **`svelte.config.js`** has `kit.alias: { $lib: 'src' }` — overrides SvelteKit's default
2. **`vite.config.ts`** has `resolve.alias: { $lib: resolve('src') }` — ensures Vite resolves it during SSR build
3. **`src/lib` exists as a junction** pointing to `src` — this is a workaround because SvelteKit's internal SSR build can still resolve `$lib` to `src/lib` before the Vite alias takes effect. On Windows this is a `mklink /J` junction; on Unix it would be a symlink. If the junction is missing, create it:

```bash
# Windows (admin not required for junctions)
cmd.exe /c "mklink /J ui\src\lib ui\src"

# Unix
ln -s . ui/src/lib
```

### Key endpoints and the UI dev proxy

During UI development (`npm run dev`), Vite proxies to `localhost:8080`:
- `/v1/*` → chat completions
- `/props`, `/models`, `/tools`, `/slots`, `/cors-proxy`

The proxy server must be running separately for the UI dev server to function.

### Branding configuration

Copy `ui/.env.example` to `ui/.env` and customize. The `.env` file is git-ignored.

| Variable | Default | Controls |
|---|---|---|
| `VITE_PUBLIC_APP_NAME` | `llama-ui` | Page title, sidebar brand name |
| `VITE_PUBLIC_GREETING` | `Hello there` | New-chat welcome heading |
| `VITE_PUBLIC_SUBTITLE` | `Type a message or upload files to get started` | New-chat subtitle (no audio) |
| `VITE_PUBLIC_SUBTITLE_AUDIO` | `Record audio, type a message or upload files to get started` | New-chat subtitle (audio supported) |
| `VITE_PUBLIC_DEFAULT_EXTERNAL_MODEL` | (none) | JSON object seeding a default external model on first launch. Fields: `name`, `baseUrl`, `apiKey`, `modelId`. Only applied when no external models exist in localStorage. Example: `{"name":"My Gateway","baseUrl":"https://api.example.com/v1","apiKey":"sk-xxx","modelId":"my-model"}` |

These are consumed in `src/constants/ui.ts` and used by `ChatScreenGreeting.svelte` (greeting/subtitle) and `SidebarNavigation.svelte` (app name).

### Vendored dependencies

- `vendor/cpp-httplib/` — single-header C++ HTTP library (used as a static library)
- `vendor/boringssl/` — optional, fetched on demand when `PROXY_WITH_HTTPS=ON`
