#include "vendor/cpp-httplib/httplib.h"
#include "assets.h"

#include <algorithm>
#include <cctype>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <queue>
#include <string>
#include <thread>

// simple thread-safe queue for streaming proxy data
struct pipe_t {
    struct chunk_t {
        std::string data;
        bool done = false;
    };

    std::mutex mtx;
    std::condition_variable cv;
    std::queue<chunk_t> q;
    bool closed = false;

    void push(chunk_t c) {
        std::lock_guard<std::mutex> lk(mtx);
        q.push(std::move(c));
        cv.notify_one();
    }

    bool pop(chunk_t & out) {
        std::unique_lock<std::mutex> lk(mtx);
        cv.wait(lk, [this] { return !q.empty() || closed; });
        if (q.empty()) return false;
        out = std::move(q.front());
        q.pop();
        return true;
    }

    void close() {
        std::lock_guard<std::mutex> lk(mtx);
        closed = true;
        cv.notify_all();
    }
};

static std::string to_lower(const std::string & s) {
    std::string r = s;
    std::transform(r.begin(), r.end(), r.begin(), [](unsigned char c) { return std::tolower(c); });
    return r;
}

// parse scheme://host:port/path from URL
struct url_parts {
    std::string scheme;
    std::string host;
    int port = 80;
    std::string path = "/";
};

static url_parts parse_url(const std::string & url) {
    url_parts parts;
    auto sep = url.find("://");
    if (sep == std::string::npos) throw std::invalid_argument("invalid URL: no scheme");
    parts.scheme = url.substr(0, sep);
    auto rest = url.substr(sep + 3);
    auto slash = rest.find('/');
    if (slash != std::string::npos) {
        parts.host = rest.substr(0, slash);
        parts.path = rest.substr(slash);
    } else {
        parts.host = rest;
        parts.path = "/";
    }
    auto colon = parts.host.find(':');
    if (colon != std::string::npos) {
        parts.port = std::stoi(parts.host.substr(colon + 1));
        parts.host = parts.host.substr(0, colon);
    } else if (parts.scheme == "https") {
        parts.port = 443;
    }
    return parts;
}

static std::string find_header(const httplib::Headers & headers, const std::string & name) {
    auto lower = to_lower(name);
    for (const auto & [k, v] : headers) {
        if (to_lower(k) == lower) return v;
    }
    return {};
}

// proxy a chat completion request to an external API
static void proxy_chat_completion(const httplib::Request & req, httplib::Response & res) {
    auto base_url = find_header(req.headers, "x-proxy-base-url");
    auto api_key  = find_header(req.headers, "x-proxy-api-key");

    if (base_url.empty()) {
        res.status = 400;
        res.set_content(R"({"error":{"code":400,"message":"missing X-Proxy-Base-URL header","type":"invalid_request_error"}})",
                        "application/json; charset=utf-8");
        return;
    }
    if (api_key.empty()) {
        res.status = 400;
        res.set_content(R"({"error":{"code":400,"message":"missing X-Proxy-API-Key header","type":"invalid_request_error"}})",
                        "application/json; charset=utf-8");
        return;
    }

    url_parts target;
    try {
        target = parse_url(base_url);
    } catch (const std::exception & e) {
        res.status = 400;
        std::string err = R"({"error":{"code":400,"message":")" + std::string(e.what()) + R"(","type":"invalid_request_error"}})";
        res.set_content(err, "application/json; charset=utf-8");
        return;
    }

    while (!target.path.empty() && target.path.back() == '/') target.path.pop_back();
    target.path += "/chat/completions";

    // create client
    std::shared_ptr<httplib::ClientImpl> cli;
    if (target.scheme == "https") {
#ifdef CPPHTTPLIB_OPENSSL_SUPPORT
        auto ssl = std::make_shared<httplib::SSLClient>(target.host, target.port);
        ssl->enable_server_certificate_verification(false);
        cli = ssl;
#else
        res.status = 500;
        res.set_content("{\"error\":{\"code\":500,\"message\":\"HTTPS not supported (rebuild with BoringSSL)\"}}",
                        "application/json; charset=utf-8");
        return;
#endif
    } else {
        cli = std::make_shared<httplib::ClientImpl>(target.host, target.port);
    }

    cli->set_follow_location(true);
    cli->set_connection_timeout(120, 0);
    cli->set_write_timeout(120, 0);
    cli->set_read_timeout(120, 0);

    // build headers to forward
    httplib::Headers fwd_headers;
    for (const auto & [k, v] : req.headers) {
        auto lower = to_lower(k);
        if (lower == "x-proxy-base-url" || lower == "x-proxy-api-key" ||
            lower == "host" || lower == "content-length" ||
            lower == "accept-encoding" || lower == "transfer-encoding") continue;
        fwd_headers.emplace(k, v);
    }
    fwd_headers.emplace("Authorization", "Bearer " + api_key);

    // check if client wants streaming
    bool is_stream = false;
    std::string body_str(req.body);
    if (!body_str.empty()) {
        // simplistic stream detection: look for "stream":true in JSON
        auto pos = body_str.find("\"stream\"");
        if (pos != std::string::npos) {
            auto colon = body_str.find(':', pos);
            if (colon != std::string::npos) {
                auto val = body_str.substr(colon + 1);
                is_stream = val.find("true") != std::string::npos;
            }
        }
    }

    if (is_stream) {
        // streaming proxy using pipe
        auto pipe = std::make_shared<pipe_t>();

        std::thread proxy_thread([cli, fwd_headers, target, body_str, pipe]() {
            // override stream detection for the request body
            auto send_headers = fwd_headers;

            httplib::Request up_req;
            up_req.method = "POST";
            up_req.path = target.path;
            up_req.body = body_str;
            for (auto & [k, v] : send_headers) up_req.headers.emplace(k, v);
            up_req.set_header("Content-Type", "application/json; charset=utf-8");

            up_req.content_receiver = [pipe](const char * data, size_t len, size_t /*offset*/, size_t /*total*/) {
                pipe->push({std::string(data, len), false});
                return true;
            };

            auto result = cli->send(std::move(up_req));
            if (result.error() != httplib::Error::Success) {
                std::string err = R"({"error":{"message":"")" + httplib::to_string(result.error()) + R"(","type":"proxy_error"}})";
                pipe->push({err, false});
            }
            pipe->push({"", true});
        });

        res.set_chunked_content_provider("text/event-stream", [pipe](size_t, httplib::DataSink & sink) -> bool {
            pipe_t::chunk_t c;
            while (pipe->pop(c)) {
                if (c.done) {
                    sink.done();
                    return false;
                }
                if (!c.data.empty()) {
                    if (!sink.write(c.data.data(), c.data.size())) return false;
                }
            }
            sink.done();
            return false;
        });

        proxy_thread.detach();
    } else {
        // non-streaming: forward and return full response
        auto result = cli->Post(target.path, fwd_headers, body_str, "application/json; charset=utf-8");
        if (result.error() != httplib::Error::Success) {
            res.status = 502;
            res.set_content(
                R"({"error":{"code":502,"message":")" + httplib::to_string(result.error()) + R"(","type":"proxy_error"}})",
                "application/json; charset=utf-8");
            return;
        }
        res.status = result->status;
        res.set_content(result->body, "application/json; charset=utf-8");
    }
}

int main(int argc, char ** argv) {
    try {
    int port = 8080;
    std::string host = "127.0.0.1";
    bool enable_ui = true;

    for (int i = 1; i < argc; i++) {
        if (std::strcmp(argv[i], "--port") == 0 && i + 1 < argc) {
            port = std::stoi(argv[++i]);
        } else if (std::strcmp(argv[i], "--host") == 0 && i + 1 < argc) {
            host = argv[++i];
        } else if (std::strcmp(argv[i], "--ui") == 0) {
            enable_ui = true;
        } else if (std::strcmp(argv[i], "--no-ui") == 0 || std::strcmp(argv[i], "--no-webui") == 0) {
            enable_ui = false;
        } else if (std::strcmp(argv[i], "-h") == 0 || std::strcmp(argv[i], "--help") == 0) {
            printf("innochat: minimal external-model proxy server\n\n");
            printf("Usage: innochat [options]\n");
            printf("  --port N     listen port (default 8080)\n");
            printf("  --host HOST  bind address (default 127.0.0.1)\n");
            printf("  --ui         enable embedded Web UI (default)\n");
            printf("  --no-ui      disable Web UI\n");
            printf("  -h, --help   show this help\n");
            return 0;
        }
    }

    httplib::Server srv;

    srv.set_pre_routing_handler([](const httplib::Request & req, httplib::Response & res) {
        res.set_header("Access-Control-Allow-Origin", req.get_header_value("Origin"));
        if (req.method == "OPTIONS") {
            res.set_header("Access-Control-Allow-Credentials", "true");
            res.set_header("Access-Control-Allow-Methods", "GET, POST");
            res.set_header("Access-Control-Allow-Headers", "*");
            res.set_content("", "text/plain");
            return httplib::Server::HandlerResponse::Handled;
        }
        return httplib::Server::HandlerResponse::Unhandled;
    });

    // proxy endpoint (must be registered before UI to take priority)
    srv.Post("/proxy/chat/completions", proxy_chat_completion);

    // health check
    srv.Get("/health", [](const httplib::Request &, httplib::Response & res) {
        res.set_content(R"({"status":"ok"})", "application/json; charset=utf-8");
    });

    // server props (minimal, so UI can initialize)
    srv.Get("/props", [](const httplib::Request &, httplib::Response & res) {
        res.set_content(R"({"role":"router","default_generation_settings":{"n_ctx":128000,"params":{"temperature":0.7,"max_tokens":4096}}})",
                        "application/json; charset=utf-8");
    });

    // model list (empty — external models are client‑side only)
    auto models_handler = [](const httplib::Request &, httplib::Response & res) {
        res.set_content(R"({"object":"list","data":[]})", "application/json; charset=utf-8");
    };
    srv.Get("/models",    models_handler);
    srv.Get("/v1/models", models_handler);

    // embed Web UI if requested
#ifdef PROXY_NO_UI
    (void)enable_ui;
#else
    if (enable_ui) {
        auto serve = [](const unsigned char * data, size_t size, const char * mime, bool isolation) {
            return [data, size, mime, isolation](const httplib::Request &, httplib::Response & res) {
                if (!data || !size) { res.status = 404; return; }
                if (isolation) {
                    res.set_header("Cross-Origin-Embedder-Policy", "require-corp");
                    res.set_header("Cross-Origin-Opener-Policy", "same-origin");
                }
                res.set_content(reinterpret_cast<const char*>(data), size, mime);
            };
        };
        srv.Get("/",          serve(asset_index_html, asset_index_html_size, "text/html; charset=utf-8", true));
        srv.Get("/bundle.js", serve(asset_bundle_js,  asset_bundle_js_size,  "application/javascript; charset=utf-8", false));
        srv.Get("/bundle.css",serve(asset_bundle_css, asset_bundle_css_size, "text/css; charset=utf-8", false));
    }
#endif

    printf("Proxy server listening on http://%s:%d\n", host.c_str(), port);
    fflush(stdout);

    if (!srv.listen(host.c_str(), port)) {
        fprintf(stderr, "ERROR: failed to bind to %s:%d (port in use? run as admin for <1024?)\n", host.c_str(), port);
        fprintf(stderr, "Press any key to exit...\n");
        fflush(stderr);
        getchar();
        return 1;
    }
    return 0;
    } catch (const std::exception & e) {
        fprintf(stderr, "FATAL: %s\n", e.what());
        fprintf(stderr, "Press any key to exit...\n");
        fflush(stderr);
        getchar();
        return 1;
    }
}
