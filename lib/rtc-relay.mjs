// WebRTC ⇄ xAI realtime WebSocket relay.
//
// Each browser session follows this flow:
//
//   Browser  ──(HTTP POST /api/rtc/offer, SDP)──►  this module
//            ◄──────(HTTP response, SDP)──────────
//            ══════(WebRTC DataChannel)══════════  ⇄  this module  ⇄  wss://api.x.ai/v1/realtime
//
// Why a DataChannel (and not a media track)?
//   WebRTC media tracks default to Opus. The xAI realtime API only accepts
//   PCM16 / G.711, so we'd have to transcode. A DataChannel carrying raw
//   PCM16 binary frames is simpler, lossless, and integrates cleanly with
//   the API's `input_audio_buffer.append` + `response.output_audio.delta`
//   events.
//
// The relay is a transparent pipe *almost* everything — the client owns
// session config (voice, instructions, tools, VAD). The server only:
//   1. Adds the Authorization header to the xAI upstream.
//   2. Optionally unwraps `response.output_audio.delta.audio` from base64
//      into a binary DataChannel frame for bandwidth.
//   3. Buffers DataChannel audio sends until the xAI WS is open.

import { RTCPeerConnection } from "werift";
import { WebSocket as NodeWebSocket } from "ws";
import { randomUUID } from "node:crypto";

const XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime";
const DEFAULT_MODEL = "grok-voice-think-fast-1.0";
// Bandwidth optimisation: strip base64 on audio frames flowing to the
// client and re-wrap on audio frames flowing to xAI. Disable if you want
// full JSON fidelity on the wire (e.g. for recording / debugging).
const BINARY_AUDIO_FRAMES = true;

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export class RtcRelay {
  constructor({ apiKey, model, verbose = false }) {
    this.apiKey = apiKey;
    this.model = model || DEFAULT_MODEL;
    this.verbose = verbose;
    this.sessions = new Map();
  }

  log(id, ...args) {
    console.log(`[rtc ${id}]`, ...args);
  }

  /**
   * Handle an incoming SDP offer from the browser. Returns the SDP answer.
   *
   * @param {string} sdp       Browser's SDP offer.
   * @param {object} opts
   * @param {string} [opts.model]  Override the default xAI model.
   * @returns {Promise<{sessionId: string, sdp: string, type: 'answer'}>}
   */
  async handleOffer(sdp, opts = {}) {
    if (!this.apiKey) {
      throw new Error("XAI_API_KEY is not configured on the server.");
    }

    const sessionId = randomUUID().slice(0, 8);
    this.log(sessionId, "← offer", `(${sdp.length} chars)`);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const session = {
      id: sessionId,
      pc,
      dc: null,
      upstream: null,
      upstreamOpen: false,
      pendingUpstream: [], // JSON frames to forward once xAI WS is open
      pendingClient: [], // JSON/binary to forward once DataChannel opens
      closed: false,
      openedAt: Date.now(),
      clientFramesIn: 0,
      upstreamFramesIn: 0,
    };
    this.sessions.set(sessionId, session);

    // -- Lifecycle --
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.log(sessionId, "pc state:", state);
      if (state === "failed" || state === "disconnected" || state === "closed") {
        this.closeSession(sessionId);
      }
    };
    pc.oniceconnectionstatechange = () => {
      this.log(sessionId, "ice state:", pc.iceConnectionState);
    };

    // -- xAI upstream --
    const model = opts.model || this.model;
    const upstreamUrl = `${XAI_REALTIME_URL}?model=${encodeURIComponent(model)}`;
    this.log(sessionId, "→ upstream", upstreamUrl);
    const upstream = new NodeWebSocket(upstreamUrl, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    session.upstream = upstream;

    upstream.on("open", () => {
      session.upstreamOpen = true;
      this.log(sessionId, "upstream open");
      // Flush anything the client sent before the upstream was ready.
      for (const frame of session.pendingUpstream) {
        try {
          upstream.send(frame);
        } catch (err) {
          this.log(sessionId, "flush upstream err", err?.message || err);
        }
      }
      session.pendingUpstream.length = 0;
    });

    upstream.on("message", (data, isBinary) => {
      if (session.closed) return;
      session.upstreamFramesIn++;
      if (isBinary) {
        // xAI realtime API doesn't send binary frames today, but be safe.
        this.sendToClient(session, data, true);
        return;
      }
      // Text frame from xAI. Optionally unwrap audio.delta → binary.
      const text = data.toString("utf8");
      // Log every non-audio event type so we can see the actual flow.
      if (
        this.verbose &&
        !text.includes("response.output_audio.delta") &&
        !text.includes("input_audio_buffer.append")
      ) {
        try {
          const evt = JSON.parse(text);
          const extra =
            evt?.type === "error"
              ? ` · error=${JSON.stringify(evt.error || evt).slice(0, 300)}`
              : "";
          this.log(
            session.id,
            `← upstream: ${evt?.type || "?"}${extra}`
          );
        } catch {
          this.log(session.id, "← upstream: (non-JSON frame)");
        }
      }
      if (BINARY_AUDIO_FRAMES) {
        // Cheap substring check before JSON.parse.
        if (text.includes("response.output_audio.delta")) {
          try {
            const evt = JSON.parse(text);
            if (
              evt?.type === "response.output_audio.delta" &&
              typeof evt.delta === "string"
            ) {
              const pcm = Buffer.from(evt.delta, "base64");
              // Prefix with a 4-byte header so the client can distinguish
              // audio deltas from any future binary event types. Header:
              //   bytes 0..3  — magic "AUDI" (0x41, 0x55, 0x44, 0x49)
              //   remainder   — PCM16 LE samples
              const header = Buffer.from([0x41, 0x55, 0x44, 0x49]);
              const framed = Buffer.concat([header, pcm]);
              this.sendToClient(session, framed, true);
              // Also forward a lightweight notification so the transcript
              // can update — without the big base64 payload.
              const meta = {
                type: "response.output_audio.delta",
                response_id: evt.response_id,
                item_id: evt.item_id,
                output_index: evt.output_index,
                content_index: evt.content_index,
                bytes: pcm.length,
              };
              this.sendToClient(session, JSON.stringify(meta), false);
              return;
            }
          } catch {
            // Fall through to raw-forward.
          }
        }
      }
      this.sendToClient(session, text, false);
    });

    upstream.on("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (c) => (body += c.toString()));
      res.on("end", () => {
        const msg = `Upstream rejected: HTTP ${res.statusCode} ${res.statusMessage} — ${body.slice(0, 300)}`;
        this.log(sessionId, msg);
        this.sendToClient(
          session,
          JSON.stringify({ type: "error", error: { message: msg } }),
          false
        );
        this.closeSession(sessionId);
      });
    });

    upstream.on("close", (code, reason) => {
      this.log(
        sessionId,
        `upstream closed code=${code} reason="${reason?.toString() || ""}" · forwarded ${session.upstreamFramesIn}`
      );
      this.closeSession(sessionId);
    });

    upstream.on("error", (err) => {
      this.log(sessionId, "upstream error:", err.message);
      this.sendToClient(
        session,
        JSON.stringify({ type: "error", error: { message: err.message } }),
        false
      );
    });

    // -- DataChannel (created by the client; we receive it via ondatachannel) --
    pc.ondatachannel = (event) => {
      const channel = event.channel || event;
      this.log(sessionId, "datachannel received:", channel.label);
      this.attachDataChannel(session, channel);
    };

    // -- SDP exchange --
    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    // werift resolves ICE gathering synchronously before setLocalDescription
    // returns, so pc.localDescription already contains the final SDP.
    const localSdp = pc.localDescription?.sdp;
    if (!localSdp) throw new Error("Failed to create local SDP answer.");

    this.log(sessionId, "→ answer", `(${localSdp.length} chars)`);

    return {
      sessionId,
      type: "answer",
      sdp: localSdp,
    };
  }

  attachDataChannel(session, dc) {
    session.dc = dc;

    const dcSend = (payload, isBinary) => {
      try {
        if (isBinary) {
          dc.send(payload);
        } else {
          dc.send(typeof payload === "string" ? payload : payload.toString("utf8"));
        }
      } catch (err) {
        this.log(session.id, "dc send err:", err?.message || err);
      }
    };

    // Replace the pending-client buffer with a live-send implementation.
    const flush = () => {
      for (const item of session.pendingClient) dcSend(item.payload, item.isBinary);
      session.pendingClient.length = 0;
    };

    session.dcSend = dcSend;

    dc.onopen = () => {
      this.log(session.id, "dc open");
      flush();
    };
    dc.onclose = () => {
      this.log(session.id, "dc closed");
      this.closeSession(session.id);
    };
    dc.onerror = (err) => {
      this.log(session.id, "dc error:", err?.message || err);
    };
    dc.onmessage = (event) => {
      if (session.closed) return;
      session.clientFramesIn++;
      const data = event?.data ?? event;
      // werift hands us Buffer for binary, string for text frames.
      if (Buffer.isBuffer(data)) {
        this.handleClientBinary(session, data);
      } else if (data instanceof ArrayBuffer) {
        this.handleClientBinary(session, Buffer.from(data));
      } else {
        this.handleClientText(session, String(data));
      }
    };
  }

  handleClientBinary(session, buf) {
    // Binary from client = mic audio (PCM16 LE). Wrap and forward to xAI.
    const audioB64 = buf.toString("base64");
    const frame = JSON.stringify({
      type: "input_audio_buffer.append",
      audio: audioB64,
    });
    this.sendToUpstream(session, frame);
  }

  handleClientText(session, text) {
    // JSON control frame. Pass through, but log the type.
    if (this.verbose) {
      try {
        const evt = JSON.parse(text);
        this.log(session.id, `→ upstream: ${evt?.type || "?"}`);
      } catch {
        const snippet = text.length > 120 ? text.slice(0, 120) + "…" : text;
        this.log(session.id, "→ upstream (non-JSON):", snippet);
      }
    }
    this.sendToUpstream(session, text);
  }

  sendToUpstream(session, frame) {
    if (!session.upstream) return;
    if (!session.upstreamOpen) {
      session.pendingUpstream.push(frame);
      return;
    }
    try {
      session.upstream.send(frame);
    } catch (err) {
      this.log(session.id, "upstream send err:", err?.message || err);
    }
  }

  sendToClient(session, payload, isBinary) {
    if (session.closed) return;
    if (!session.dc || session.dc.readyState !== "open") {
      session.pendingClient.push({ payload, isBinary });
      return;
    }
    if (session.dcSend) session.dcSend(payload, isBinary);
  }

  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) return;
    session.closed = true;
    this.log(
      sessionId,
      `closing · client frames in=${session.clientFramesIn} · upstream frames in=${session.upstreamFramesIn} · age=${((Date.now() - session.openedAt) / 1000).toFixed(1)}s`
    );
    try {
      if (session.upstream && session.upstream.readyState <= 1) {
        session.upstream.close();
      }
    } catch {}
    try {
      if (session.dc && session.dc.readyState === "open") session.dc.close();
    } catch {}
    try {
      session.pc.close();
    } catch {}
    this.sessions.delete(sessionId);
  }

  closeAll() {
    for (const id of [...this.sessions.keys()]) this.closeSession(id);
  }
}
