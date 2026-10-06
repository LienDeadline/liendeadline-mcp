/**
 * Hosted Streamable HTTP entry point (docs/HOSTED.md).
 *
 * Serves only the five public, keyless tools in stateless mode: every POST /mcp gets a fresh
 * server and transport, nothing is kept between requests, and no customer key is used or
 * forwarded. Logs carry only the HTTP method, status and latency of each request, never
 * bodies, tool arguments or client addresses.
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DEFAULT_BASE_URL, VERSION } from "./api.js";
import { createHostedAnalytics } from "./analytics.js";
import { buildServer } from "./server.js";

function envInt(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be an integer of at least ${min}.`);
  return value;
}

const PORT = envInt("PORT", 8080, 0);
// Bind to loopback unless told otherwise; the container image sets HOST=0.0.0.0 for Cloud Run.
const HOST = process.env.HOST || "127.0.0.1";
const BASE_URL = process.env.LIENDEADLINE_API_URL?.replace(/\/+$/, "") || DEFAULT_BASE_URL;
const MAX_BODY_BYTES = envInt("MCP_MAX_BODY_BYTES", 64 * 1024, 1);
const REQUEST_TIMEOUT_MS = envInt("MCP_REQUEST_TIMEOUT_MS", 30_000, 1);
const RATE_LIMIT_MAX = envInt("MCP_RATE_LIMIT_MAX", 120, 1);
const RATE_LIMIT_WINDOW_MS = envInt("MCP_RATE_LIMIT_WINDOW_MS", 60_000, 1);
// Proxies in front of this server that append the client address to X-Forwarded-For: 1 for
// Cloud Run alone, 2 when a proxied Cloudflare hostname sits in front of it, 0 locally.
const TRUST_PROXY_HOPS = envInt("MCP_TRUST_PROXY_HOPS", 0, 0);
const analytics = createHostedAnalytics(VERSION);

const MCP_PATH = "/mcp";
// Cloud Run's front end answers paths ending in "z" itself, so /health is the externally reachable alias.
const HEALTH_PATHS = new Set(["/healthz", "/health"]);
// OpenAI's app directory verifies domain ownership by fetching the token it issues from this path
// as plain text. The path answers 404 until OPENAI_APPS_CHALLENGE is set.
const OPENAI_CHALLENGE_PATH = "/.well-known/openai-apps-challenge";
const OPENAI_APPS_CHALLENGE = process.env.OPENAI_APPS_CHALLENGE?.trim() ?? "";
if (OPENAI_APPS_CHALLENGE && !/^[\x21-\x7e]{1,512}$/.test(OPENAI_APPS_CHALLENGE)) {
  throw new Error("OPENAI_APPS_CHALLENGE must be 1 to 512 printable ASCII characters without spaces.");
}
// Clients such as Claude show the favicon of the server's host next to the connector. The image
// copies assets/icon.png next to dist/; without it these paths answer 404.
const FAVICON_PATHS = new Set(["/favicon.ico", "/favicon.png"]);
const FAVICON = (() => {
  try {
    return readFileSync(new URL("../assets/icon.png", import.meta.url));
  } catch {
    return undefined;
  }
})();

// Browser-based MCP clients need CORS. The tools are public and keyless, so any origin may call them.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};
const PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Max-Age": "86400",
};

function log(entry: Record<string, unknown>) {
  console.log(JSON.stringify(entry));
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(text)),
    ...headers,
  });
  res.end(text);
}

const rpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

/** Fixed-window counter per client, kept in memory per instance. */
class RateLimiter {
  readonly #hits = new Map<string, { count: number; resetAt: number }>();

  constructor(readonly max: number, readonly windowMs: number, readonly maxClients = 10_000) {
    setInterval(() => this.sweep(), windowMs).unref();
  }

  /** Returns 0 when the request may proceed, otherwise the seconds until the window resets. */
  hit(key: string, now = Date.now()): number {
    let entry = this.#hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.#hits.delete(key);
      // Bound memory under address churn by dropping the oldest window.
      if (this.#hits.size >= this.maxClients) this.#hits.delete(this.#hits.keys().next().value!);
      entry = { count: 0, resetAt: now + this.windowMs };
      this.#hits.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= this.max ? 0 : Math.ceil((entry.resetAt - now) / 1000);
  }

  sweep(now = Date.now()) {
    for (const [key, entry] of this.#hits) if (entry.resetAt <= now) this.#hits.delete(key);
  }
}

const limiter = new RateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);

/**
 * The address the nearest trusted proxy saw. Each proxy appends the address it received the
 * request from, so only entries counted from the right are trustworthy; anything to their left
 * is client-supplied. IPv6 clients usually control a whole /64, so they share one counter.
 */
function clientKey(req: IncomingMessage): string {
  let address = req.socket.remoteAddress ?? "";
  if (TRUST_PROXY_HOPS > 0) {
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const candidate = forwarded[Math.max(0, forwarded.length - TRUST_PROXY_HOPS)];
    if (candidate && isIP(candidate)) address = candidate;
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1];
  if (isIP(address) !== 6) return address;
  const [head, tail] = address.split("%")[0].split("::");
  const left = head ? head.split(":") : [];
  const right = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** Reads at most `limit` bytes. Oversized bodies are refused without buffering the rest. */
function readBody(req: IncomingMessage, limit: number): Promise<{ tooLarge: true } | { tooLarge: false; text: string }> {
  if (Number(req.headers["content-length"]) > limit) return Promise.resolve({ tooLarge: true });
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("close", onClose);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        cleanup();
        // Discard whatever is still arriving until the connection closes after the 413.
        req.resume();
        resolve({ tooLarge: true });
      } else {
        chunks.push(chunk);
      }
    };
    const onEnd = () => {
      cleanup();
      resolve({ tooLarge: false, text: Buffer.concat(chunks).toString("utf8") });
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Request closed before its body was read."));
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("close", onClose);
  });
}

/** One stateless MCP exchange: a fresh public-only server and transport for this request alone. */
async function handleMcp(req: IncomingMessage, res: ServerResponse, message: unknown) {
  const server = buildServer({ includeCustomerTools: false, baseUrl: BASE_URL });
  analytics?.instrument(server);
  if (analytics) {
    // The SDK otherwise adds a client/session correlation token to initialize responses.
    // This endpoint remains stateless and intentionally does not expose that token.
    const setHeader = res.setHeader;
    res.setHeader = function (name, value) {
      return name.toLowerCase() === "mcp-session-id" ? this : setHeader.call(this, name, value);
    };
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const release = () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // Closing first aborts the tool handler, so a late result is dropped instead of written after this reply.
    release();
    if (!res.headersSent) sendJson(res, 504, rpcError(-32001, "Request timed out."), { Connection: "close" });
    else res.destroy();
  }, REQUEST_TIMEOUT_MS);
  res.on("close", () => {
    clearTimeout(timer);
    release();
  });
  await server.connect(transport);
  if (timedOut) return;
  await transport.handleRequest(req, res, message);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value);
  let path: string;
  try {
    path = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    return sendJson(res, 400, { error: "Bad request" });
  }

  if (HEALTH_PATHS.has(path)) {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, HEAD" });
    return sendJson(res, 200, { status: "ok" });
  }
  if (FAVICON_PATHS.has(path) && FAVICON) {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, HEAD" });
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": String(FAVICON.length),
      "Cache-Control": "public, max-age=86400",
    });
    res.end(req.method === "HEAD" ? undefined : FAVICON);
    return;
  }
  if (path === OPENAI_CHALLENGE_PATH && OPENAI_APPS_CHALLENGE) {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, HEAD" });
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(OPENAI_APPS_CHALLENGE)),
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : OPENAI_APPS_CHALLENGE);
    return;
  }
  if (path !== MCP_PATH) return sendJson(res, 404, { error: "Not found" });

  if (req.method === "OPTIONS") {
    res.writeHead(204, PREFLIGHT_HEADERS).end();
    return;
  }
  // Stateless: there is no server-initiated SSE stream (GET) and no session to delete (DELETE).
  if (req.method !== "POST") return sendJson(res, 405, rpcError(-32000, "Method not allowed."), { Allow: "POST, OPTIONS" });

  const retryAfter = limiter.hit(clientKey(req));
  if (retryAfter > 0) {
    return sendJson(res, 429, rpcError(-32000, `Too many requests; retry after ${retryAfter} seconds.`), {
      "Retry-After": String(retryAfter),
    });
  }

  const body = await readBody(req, MAX_BODY_BYTES);
  if (body.tooLarge) {
    return sendJson(res, 413, rpcError(-32000, `Payload Too Large: request body must not exceed ${MAX_BODY_BYTES} bytes.`), {
      Connection: "close",
    });
  }
  let message: unknown;
  try {
    message = JSON.parse(body.text);
  } catch {
    return sendJson(res, 400, rpcError(-32700, "Parse error: Invalid JSON"));
  }
  await handleMcp(req, res, message);
}

const httpServer = createServer({
  // Bound slow uploads; MCP processing is bounded separately by REQUEST_TIMEOUT_MS.
  headersTimeout: Math.min(10_000, REQUEST_TIMEOUT_MS),
  requestTimeout: REQUEST_TIMEOUT_MS,
  connectionsCheckingInterval: Math.min(1_000, REQUEST_TIMEOUT_MS),
}, (req, res) => {
  const started = performance.now();
  res.on("close", () => {
    // 499: the client went away before the response finished.
    const status = res.writableFinished ? res.statusCode : 499;
    log({
      severity: status >= 500 ? "ERROR" : "INFO",
      method: req.method,
      status,
      latencyMs: Math.round(performance.now() - started),
    });
  });
  handle(req, res).catch(() => {
    // Details are deliberately not logged: they can echo request content.
    if (!res.headersSent) sendJson(res, 500, rpcError(-32603, "Internal error"));
    else res.destroy();
  });
});

if (process.env.LIENDEADLINE_API_KEY) {
  log({ severity: "WARNING", message: "LIENDEADLINE_API_KEY is ignored: the hosted server serves only the public tools and never sends a key." });
}

httpServer.listen(PORT, HOST, () => {
  const address = httpServer.address();
  log({
    severity: "INFO",
    message: "liendeadline-mcp hosted server listening",
    port: typeof address === "object" && address ? address.port : PORT,
  });
});

// Cloud Run sends SIGTERM before stopping an instance: finish in-flight requests, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    httpServer.close(async () => {
      await analytics?.shutdown();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 8_000).unref();
  });
}
