// Custom Next.js server with WebSocket proxy routes for xAI Grok STT + TTS.
// The xAI API key never leaves this Node process — browsers connect to this
// server's /api/ws/stt and /api/ws/tts endpoints, which in turn open
// authenticated WebSocket connections to api.x.ai.

import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { RtcRelay } from "./lib/rtc-relay.mjs";

// Minimal .env / .env.local loader so we don't need an extra dependency.
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "localhost";
const port = Number(process.env.PORT) || 3000;

const XAI_API_KEY = process.env.XAI_API_KEY;
if (!XAI_API_KEY) {
  console.warn(
    "\n\x1b[33m[warn] XAI_API_KEY is not set. Copy .env.example to .env.local and add your key.\x1b[0m\n"
  );
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
// Forward non-proxy upgrades (notably /_next/webpack-hmr in dev) to Next.
const upgradeHandler =
  typeof app.getUpgradeHandler === "function" ? app.getUpgradeHandler() : null;

const STT_UPSTREAM = "wss://api.x.ai/v1/stt";
const TTS_UPSTREAM = "wss://api.x.ai/v1/tts";

// WebRTC relay for the Voice Agent mode. Bridges browser WebRTC
// DataChannel ⇄ xAI realtime WebSocket.
const rtcRelay = new RtcRelay({
  apiKey: XAI_API_KEY,
  model: process.env.XAI_REALTIME_MODEL,
  verbose: process.env.VOICE_DEBUG === "1" || process.env.NODE_ENV !== "production",
});

/**
 * Pipe a client WebSocket ⇄ xAI upstream WebSocket both ways.
 * The upstream uses a Bearer token in the Authorization header, which is
 * added here on the server — the browser never sees the API key.
 */
const VERBOSE =
  process.env.VOICE_DEBUG === "1" || process.env.NODE_ENV !== "production";

function preview(buf, isBinary) {
  if (isBinary) return `<binary ${buf.length} bytes>`;
  const s = buf.toString("utf8");
  return s.length > 160 ? s.slice(0, 160) + "…" : s;
}

function bridge(clientWs, upstreamUrl, logTag) {
  if (!XAI_API_KEY) {
    clientWs.send(
      JSON.stringify({
        type: "error",
        message: "Server missing XAI_API_KEY. Set it in .env.local and restart.",
      })
    );
    clientWs.close(1011, "server not configured");
    return;
  }

  const sessionId = randomUUID().slice(0, 8);
  const log = (...args) => console.log(`[${logTag} ${sessionId}]`, ...args);

  log("→ upstream", upstreamUrl);

  const upstream = new WebSocket(upstreamUrl, {
    headers: { Authorization: `Bearer ${XAI_API_KEY}` },
  });

  const pending = [];
  let upstreamOpen = false;
  let clientMsgCount = 0;
  let upstreamMsgCount = 0;

  const flushPending = () => {
    while (pending.length) {
      const { data, isBinary } = pending.shift();
      try {
        upstream.send(data, { binary: isBinary });
      } catch (err) {
        log("error sending buffered message", err);
      }
    }
  };

  // Capture upstream handshake response for diagnostics.
  upstream.on("unexpected-response", (_req, res) => {
    let body = "";
    res.on("data", (c) => (body += c.toString()));
    res.on("end", () => {
      log(
        `upstream rejected handshake: HTTP ${res.statusCode} ${res.statusMessage} · body=${body.slice(0, 300)}`
      );
      if (clientWs.readyState === clientWs.OPEN) {
        try {
          clientWs.send(
            JSON.stringify({
              type: "error",
              message: `Upstream rejected: HTTP ${res.statusCode} ${res.statusMessage} — ${body.slice(0, 300)}`,
            })
          );
        } catch {}
        clientWs.close(1011, "upstream rejected");
      }
    });
  });

  upstream.on("open", () => {
    upstreamOpen = true;
    log("upstream connected");
    flushPending();
  });

  upstream.on("message", (data, isBinary) => {
    upstreamMsgCount++;
    if (VERBOSE && upstreamMsgCount <= 6) {
      log(`← upstream msg #${upstreamMsgCount}: ${preview(data, isBinary)}`);
    } else if (VERBOSE && upstreamMsgCount === 7) {
      log("← upstream msg #7: (suppressing further per-message logs)");
    }
    if (clientWs.readyState === clientWs.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  upstream.on("close", (code, reason) => {
    log(
      `upstream closed code=${code} reason="${reason?.toString() || ""}" · forwarded ${upstreamMsgCount} msgs`
    );
    if (clientWs.readyState === clientWs.OPEN) {
      clientWs.close(code && code >= 1000 && code <= 4999 ? code : 1011, reason);
    }
  });

  upstream.on("error", (err) => {
    log("upstream error:", err.message);
    if (clientWs.readyState === clientWs.OPEN) {
      try {
        clientWs.send(
          JSON.stringify({ type: "error", message: `upstream: ${err.message}` })
        );
      } catch {}
    }
  });

  clientWs.on("message", (data, isBinary) => {
    clientMsgCount++;
    if (VERBOSE && (clientMsgCount <= 4 || !isBinary)) {
      log(`→ client msg #${clientMsgCount}: ${preview(data, isBinary)}`);
    }
    if (!upstreamOpen) {
      pending.push({ data, isBinary });
      return;
    }
    try {
      upstream.send(data, { binary: isBinary });
    } catch (err) {
      log("error forwarding to upstream", err);
    }
  });

  clientWs.on("close", (code, reason) => {
    log(
      `client closed code=${code} reason="${reason?.toString() || ""}" · received ${clientMsgCount} msgs`
    );
    if (
      upstream.readyState === WebSocket.OPEN ||
      upstream.readyState === WebSocket.CONNECTING
    ) {
      upstream.close();
    }
  });

  clientWs.on("error", (err) => {
    log("client error:", err.message);
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  });
}

await app.prepare();

const server = createServer(async (req, res) => {
  const parsed = parse(req.url, true);

  // WebRTC signalling endpoint — accepts SDP offer, returns SDP answer.
  // POST /api/rtc/offer  { sdp: "...", model?: "grok-voice-think-fast-1.0" }
  if (req.method === "POST" && parsed.pathname === "/api/rtc/offer") {
    try {
      const body = await readJsonBody(req);
      if (!body || typeof body.sdp !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing sdp" }));
        return;
      }
      const { sessionId, sdp, type } = await rtcRelay.handleOffer(body.sdp, {
        model: body.model,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId, type, sdp }));
    } catch (err) {
      console.error("[rtc] offer error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: err?.message || "offer failed" })
      );
    }
    return;
  }

  if (
    req.method === "DELETE" &&
    parsed.pathname &&
    parsed.pathname.startsWith("/api/rtc/session/")
  ) {
    const id = parsed.pathname.slice("/api/rtc/session/".length);
    rtcRelay.closeSession(id);
    res.writeHead(204);
    res.end();
    return;
  }

  handle(req, res, parsed);
});

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// Separate WebSocket servers for each proxy route (easier per-route logic).
const sttWss = new WebSocketServer({ noServer: true });
const ttsWss = new WebSocketServer({ noServer: true });

sttWss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${hostname}`);
  // Whitelist/forward the documented STT query params.
  const allowed = [
    "sample_rate",
    "encoding",
    "interim_results",
    "endpointing",
    "language",
    "diarize",
    "multichannel",
    "channels",
  ];
  const forwarded = new URLSearchParams();
  for (const key of allowed) {
    const value = url.searchParams.get(key);
    if (value !== null) forwarded.set(key, value);
  }
  const upstreamUrl = `${STT_UPSTREAM}?${forwarded.toString()}`;
  bridge(ws, upstreamUrl, "stt");
});

ttsWss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${hostname}`);
  const allowed = ["voice", "language", "codec", "sample_rate", "bit_rate"];
  const forwarded = new URLSearchParams();
  for (const key of allowed) {
    const value = url.searchParams.get(key);
    if (value !== null) forwarded.set(key, value);
  }
  const upstreamUrl = `${TTS_UPSTREAM}?${forwarded.toString()}`;
  bridge(ws, upstreamUrl, "tts");
});

server.on("upgrade", (req, socket, head) => {
  const { pathname } = parse(req.url, true);
  if (pathname === "/api/ws/stt") {
    sttWss.handleUpgrade(req, socket, head, (ws) => {
      sttWss.emit("connection", ws, req);
    });
    return;
  }
  if (pathname === "/api/ws/tts") {
    ttsWss.handleUpgrade(req, socket, head, (ws) => {
      ttsWss.emit("connection", ws, req);
    });
    return;
  }
  // Forward anything else (e.g. /_next/webpack-hmr) to Next's own handler.
  if (upgradeHandler) {
    upgradeHandler(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(port, () => {
  console.log(
    `\n\x1b[32m▲\x1b[0m Grok Voice Studio ready → \x1b[36mhttp://${hostname}:${port}\x1b[0m`
  );
  console.log(
    `  \x1b[2mWebSocket proxies: /api/ws/stt  ·  /api/ws/tts\x1b[0m`
  );
  console.log(
    `  \x1b[2mWebRTC agent relay:  /api/rtc/offer  (POST)\x1b[0m\n`
  );
});

const shutdown = (signal) => {
  console.log(`\n[${signal}] shutting down — closing RTC sessions`);
  try {
    rtcRelay.closeAll();
  } catch {}
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
