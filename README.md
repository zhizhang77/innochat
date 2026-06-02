# innochat

A lightweight standalone proxy server that forwards OpenAI-compatible chat completion requests to external APIs, with an embedded conversational Web UI.

Modified from the [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` component — the original's built-in model inference has been replaced with a transparent proxy layer that routes requests to any external OpenAI-compatible API.

## Features

- **Protocol-compatible proxy** — clients connect to innochat exactly as they would to `llama-server`, but requests are forwarded to external APIs configured via HTTP headers
- **Streaming & non-streaming** — full SSE (Server-Sent Events) streaming support with chunked transfer encoding, plus standard non-streaming completions
- **Embedded Svelte 5 Web UI** — hash-routed SPA compiled directly into the binary; no separate frontend deployment needed
- **External model management** — models are configured client-side via the UI, persisted in IndexedDB, with optional default model seeding via environment variable
- **Flexible configuration** — `X-Proxy-Base-URL` and `X-Proxy-API-Key` headers let each client choose its own upstream endpoint
- **Per-client authentication** — each client provides its own API key via headers; the server itself needs no credentials
- **Brandable** — app name, greeting, and default model all configurable via environment variables at build time
- **Optional HTTPS** — upstream HTTPS support via BoringSSL (`PROXY_WITH_HTTPS=ON`)
- **Single-file server** — the C++ proxy core lives in a single `main.cpp`, using vendored `cpp-httplib` for HTTP

## Quick start

```bash
# Build
cmake -B build -G "MinGW Makefiles"
cmake --build build

# Run
./build/innochat --port 8080
```

Open `http://127.0.0.1:8080` in a browser.

## How it works

```
Client (Browser/API)          innochat Proxy            External API
      │                            │                         │
      ├── POST /proxy/chat/       │                         │
      │   X-Proxy-Base-URL        │                         │
      │   X-Proxy-API-Key         │                         │
      │   Body: { stream: true }  │                         │
      │                            ├── POST /v1/chat/       │
      │                            │   /completions ────────>│
      │                            │                         │
      │                            │<── SSE chunks ──────────┤
      │<── SSE chunks relay ───────┤                         │
```

The proxy reads two custom headers from incoming requests:

| Header | Purpose |
|---|---|
| `X-Proxy-Base-URL` | Base URL of the upstream API (e.g. `https://api.openai.com/v1`) |
| `X-Proxy-API-Key` | API key for the upstream service |

These headers are stripped before forwarding; `Authorization: Bearer <key>` is added upstream.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/proxy/chat/completions` | Core proxy — forwards to upstream chat completions |
| `GET` | `/health` | Health check (`{"status":"ok"}`) |
| `GET` | `/props` | Server info (role: `router`) for UI initialization |
| `GET` | `/models`, `/v1/models` | Returns empty model list (models are client-side) |
| `GET` | `/` | Embedded Web UI |

## CLI options

```
innochat [options]
  --port N     Listen port (default 8080)
  --host HOST  Bind address (default 127.0.0.1)
  --ui         Enable embedded Web UI (default)
  --no-ui      Disable Web UI
  -h, --help   Show help
```

## CMake options

| Option | Default | Description |
|---|---|---|
| `PROXY_WITH_UI` | `ON` | Embed the Web UI into the binary |
| `PROXY_WITH_HTTPS` | `OFF` | Enable HTTPS upstream via BoringSSL |

## Relationship to llama.cpp

This project began as a fork of the `llama-server` component from [llama.cpp](https://github.com/ggml-org/llama.cpp). The original server loads GGUF models locally and runs inference in-process. innochat replaces that local inference engine with an HTTP proxy layer, making it a model-agnostic router that works with any OpenAI-compatible API while preserving the same client-facing protocol and Web UI experience.

Key differences from upstream `llama-server`:

- No local model loading or inference — all completions are proxied externally
- No GGUF/GGML dependency
- Client-authenticated via `X-Proxy-API-Key` header (not server-wide API key)
- Models list is empty by default; configured dynamically client-side
- Single-file C++ core (~330 lines) with vendored HTTP library
