# Grok Audio API — Voice Studio

> A production-grade, fully open-source playground for xAI's realtime
> **Speech-to-Text**, **Text-to-Speech**, and **Voice Agent** APIs.
> Built on the same stack that powers Grok Voice, Tesla vehicles, and
> Starlink customer support.

Live-transcribe your microphone, synthesise expressive speech, and hold
real-time tool-using voice conversations with **Grok Voice Think Fast
1.0** — all streamed, all proxied through a Node server so your xAI API
key never leaves the backend.

- **Speech-to-Text** — live microphone capture at 16 kHz, streaming
  partials, chunk-finals, utterance-finals, optional speaker diarization,
  and Inverse Text Normalization (numbers, dates, currencies in their
  written form).
- **Text-to-Speech** — 5 expressive voices, 20+ languages, inline speech
  tags (`[pause]`, `[laugh]`, `<whisper>…</whisper>`, `<emphasis>`,
  `<slow>`, and more), streamed as MP3 and played through a native
  `<audio>` element.
- **Voice Agent** — full-duplex realtime voice conversation with
  `grok-voice-think-fast-1.0` (flagship) over **WebRTC**. Server-side
  Voice Activity Detection for natural barge-in, function calling,
  built-in web search and X search tools, and a premium animated
  focus-mode visualiser backed by a live chat-bubble transcript.

---

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Quickstart](#quickstart)
- [Environment variables](#environment-variables)
- [How it works](#how-it-works)
  - [Custom server + WebSocket proxy](#custom-server--websocket-proxy)
  - [Speech-to-Text pipeline](#speech-to-text-pipeline)
  - [Text-to-Speech pipeline](#text-to-speech-pipeline)
  - [Voice Agent (WebRTC) pipeline](#voice-agent-webrtc-pipeline)
- [Project structure](#project-structure)
- [API endpoints](#api-endpoints)
- [Development scripts](#development-scripts)
- [Production notes](#production-notes)
- [Security](#security)
- [Tech stack](#tech-stack)
- [Troubleshooting](#troubleshooting)
- [Credits & License](#credits--license)

---

## Features

### Speech-to-Text (live microphone)

- **Realtime WebSocket streaming** to `wss://api.x.ai/v1/stt` via a local
  backend proxy.
- **16 kHz native capture** via a Web Audio `AudioWorkletProcessor`, with
  the browser performing anti-aliased resampling instead of naïve
  JavaScript downsampling — materially better ASR accuracy.
- **Interim results** — live word-by-word transcription as you speak
  (partials update every ~500 ms; finals lock in after ~3 s chunks).
- **Utterance-final de-duplication** — the xAI API emits both chunk-finals
  and a stitched utterance-final; the UI buffers chunk-finals as "pending"
  and replaces them with the utterance-final so lines never appear twice.
- **Inverse Text Normalization (ITN)** — toggleable. When on, the model
  converts spoken forms (*"one hundred dollars"*) into written form
  (*"$100"*), and likewise for phone numbers, dates, percentages, etc.
- **Speaker diarization** — optional; labels each word with a speaker ID
  and renders a chat-style grouped view.
- **Endpointing control** — 0–2000 ms silence threshold before an
  utterance-final fires.
- **Live level meter** and elapsed timer during recording.
- Copy / clear / status indicators.

### Text-to-Speech

- **Realtime WebSocket streaming** to `wss://api.x.ai/v1/tts`.
- **5 voices** — `eve`, `ara`, `rex`, `sal`, `leo`, each with a distinct
  personality.
- **20+ languages** via BCP-47 codes (`en`, `ar-SA`, `pt-BR`, `zh`, `hi`,
  …) plus `auto` for language detection.
- **Expressive speech tags** — one-click insertion palette:
  - Inline: `[pause]`, `[long-pause]`, `[laugh]`, `[chuckle]`,
    `[sigh]`, `[breath]`
  - Wrapping: `<whisper>`, `<soft>`, `<emphasis>`, `<slow>`, `<fast>`,
    `<sing-song>` (wraps the current text selection or inserts
    `<tag>text</tag>`).
- **Live streaming progress** — chunks and bytes counter update as audio
  arrives; the Generate button flips to Stop; animated progress bar.
- **Native audio player** — MP3 at 24 kHz / 128 kbps is built into a Blob
  on `audio.done` and played through a standard `<audio>` element with
  play/pause, seek, and duration display.
- **Autoplay-safe** — the `<audio>.play()` call is triggered in the same
  task as the user gesture, so it works on Chrome/Edge/Firefox/Safari
  without needing an `AudioContext` dance.
- **One-click download** — the generated MP3 is downloadable directly
  from the player card.
- **Trace ID** surfaced for debugging with the xAI team.

### Voice Agent (WebRTC, realtime)

- **Flagship model** — `grok-voice-think-fast-1.0` by default, with the
  legacy `grok-voice-fast-1.0` selectable from a dropdown.
- **WebRTC transport** — the browser talks to the Node server over a
  single `RTCDataChannel`, which the server bridges to
  `wss://api.x.ai/v1/realtime`. Raw PCM16 rides the DataChannel as
  binary frames in both directions — no Opus transcoding, no base64
  overhead on the hot path.
- **Full-duplex conversation** — server-side Voice Activity Detection
  handles natural barge-in; tunable `threshold`, `silence_duration_ms`,
  and `prefix_padding_ms`.
- **Low-latency audio** — 24 kHz mono PCM captured through an
  `AudioWorklet` and played back through a jitter-buffered playback
  worklet. Both sides match the API's native rate, so there's zero
  resampling.
- **Premium focus-mode orb** — a live canvas visualiser with a radial
  equaliser, reactive outer ring (user mic) and pulsing inner orb
  (assistant voice). Colour palette shifts with agent state: lime while
  listening, violet while thinking, orange while speaking.
- **Chat-bubble transcript** — user messages right-aligned (lime
  tint), assistant left-aligned (violet tint), streaming caret during
  live delta updates, and tool-call chips inline in the flow.
- **Live toggle** — switch between focus mode (animated orb) and
  transcript mode at any time. The conversation is **kept in memory**
  across switches; hiding the transcript never drops a word.
- **Tools built in** —
  - Web Search (`web_search`) – server-side, zero client handling.
  - X / Twitter Search (`x_search`) with optional handle allow-list.
  - Custom client-side functions: `get_current_time()`,
    `generate_random_number()`. Drop your own into
    `lib/constants.ts → AGENT_BUILTIN_FUNCTIONS`.
- **Parallel tool calling** — if the model emits multiple function
  calls in one turn, all of them are executed in parallel, their
  outputs are submitted together, and only then is `response.create`
  emitted — matching the xAI best-practice guide exactly.
- **Interruption-safe playback** — when the VAD detects the user
  speaking, the local playback queue is flushed so the assistant goes
  quiet immediately.

### UI

- Dark studio aesthetic with lime (`#c9f26c`) primary accent and
  violet/orange ambient gradients.
- Segmented control top-right with an animated pill that auto-measures
  tab widths to slide smoothly between **STT**, **TTS**, and **Agent**
  (URL hash keeps the mode shareable — `#stt` / `#tts` / `#agent`).
- Viewport-fit layout — no awkward page scrolling; transcript scrolls
  internally only when its content exceeds its panel.
- Keyboard-focus rings, reduced-motion friendly, responsive down to
  mobile.

---

## Architecture

```
┌───────────────────┐    HTTP / WebSocket / WebRTC     ┌──────────────────────┐
│      Browser      │ ───────────────────────────────▶ │  Next.js Node server │
│                   │                                  │      (server.mjs)    │
│  React UI         │ ◀─────────────────────────────── │                      │
│  AudioWorklets    │                                  │  /api/ws/stt   ─┐    │
│  <audio> element  │                                  │  /api/ws/tts   ─┤    │
│  RTCPeerConn      │                                  │  /api/rtc/offer─┤    │
└───────────────────┘                                  │  (werift relay) │    │
                                                       └─────────────────┼────┘
                                                                         │
                                           wss://api.x.ai/v1/stt        │
                                           wss://api.x.ai/v1/tts        ▼
                                           wss://api.x.ai/v1/realtime
                                                          ┌──────────────────┐
                                                          │     xAI Grok     │
                                                          │   Voice backend  │
                                                          └──────────────────┘
```

- The browser speaks only to your own Node server.
- Your Node server opens an authenticated WebSocket upstream to xAI,
  adding the `Authorization: Bearer $XAI_API_KEY` header.
- STT / TTS: binary audio frames and JSON control frames are bridged
  transparently in both directions via the two WebSocket proxies.
- Agent: the browser negotiates a WebRTC peer connection with the Node
  server (pure-JS `werift`). A single `RTCDataChannel` carries PCM16
  audio in both directions plus all JSON control events; the server
  bridges to `wss://api.x.ai/v1/realtime`.
- The same Node process also serves the Next.js React app and handles
  Next's internal HMR WebSocket — a single, unified server.

---

## Quickstart

### Prerequisites

- **Node.js 18.17+** (20 LTS recommended)
- An xAI API key — get one at <https://console.x.ai>

### 1. Clone

```bash
git clone https://github.com/ASHR12/Grok-Audio-API.git
cd Grok-Audio-API
```

### 2. Install dependencies

```bash
npm install
```

### 3. Add your API key

```bash
cp .env.example .env.local
# then open .env.local and paste your key
```

`.env.local`:

```dotenv
XAI_API_KEY=xai-...
# Optional overrides:
# PORT=3000
# HOST=localhost
```

> `.env.local` is git-ignored. You can also use `.env` — both are read by
> the server and will never be committed.

### 4. Run the dev server

```bash
npm run dev
```

Open <http://localhost:3000>. Hit **Start recording** on the STT side, or
type something and hit **Generate & play** on the TTS side.

### 5. Production build

```bash
npm run build
npm run start
```

`npm run start` runs the custom server (`server.mjs`) in production mode
with `NODE_ENV=production`.

---

## Environment variables

| Variable              | Required | Default                        | Description                                        |
| --------------------- | :------: | ------------------------------ | -------------------------------------------------- |
| `XAI_API_KEY`         | ✓        | —                              | Your xAI API key. Server-side only, never exposed. |
| `PORT`                |          | `3000`                         | Port the Node server binds to.                     |
| `HOST`                |          | `localhost`                    | Hostname the Node server binds to.                 |
| `XAI_REALTIME_MODEL`  |          | `grok-voice-think-fast-1.0`    | Default model used by the Voice Agent mode.        |
| `VOICE_DEBUG`         |          | unset                          | Set to `1` to log previews of every WebSocket frame in both directions (already on in dev). |

All variables are read from `.env.local`, then `.env`, in that order. A
minimal `.env.example` is committed so contributors know what to set.

---

## How it works

### Custom server + WebSocket proxy

Next.js App Router does not natively support WebSocket routes, so the
project ships a small custom server (`server.mjs`) that:

1. Boots Next.js in-process (`next({ dev, hostname, port })`).
2. Creates a Node `http.Server` and serves all HTTP requests through
   Next's request handler.
3. Mounts two `ws.WebSocketServer` instances (from the `ws` npm package)
   on `/api/ws/stt` and `/api/ws/tts`.
4. On every client WebSocket connection, opens an upstream WebSocket to
   `wss://api.x.ai/v1/...` and bridges both ends:
   - Client → upstream: text frames (JSON) and binary frames (raw PCM)
     are forwarded as-is.
   - Upstream → client: same.
5. Forwards any other upgrade (notably `/_next/webpack-hmr`) to Next's
   built-in upgrade handler, so dev-mode hot reload keeps working.
6. Captures upstream handshake rejections (`401`, `400`, `404`) via
   `unexpected-response` and reports them as `{ "type": "error", ... }`
   frames to the client so the UI can surface meaningful messages.
7. Logs every session with a short UUID, message counters, and close
   codes for easy diagnostics.

### Speech-to-Text pipeline

```
┌─ Browser ─────────────────────────────────────────────────────────┐
│                                                                   │
│   getUserMedia(16 kHz mono)                                       │
│        │                                                          │
│        ▼                                                          │
│   AudioContext({ sampleRate: 16000 })  ◀── browser anti-aliasing  │
│        │                                                          │
│        ▼                                                          │
│   AudioWorklet 'pcm-capture'  ──►  Float32 → Int16 (100ms chunks) │
│        │                                                          │
│        ▼                                                          │
│   WebSocket  (binary frames, raw PCM)                             │
│        │                                                          │
└────────┼──────────────────────────────────────────────────────────┘
         │
         ▼
┌─ server.mjs ──────────────────────────────────────────────────────┐
│  forward to wss://api.x.ai/v1/stt with Authorization header       │
└───────────────────────────────────────────────────────────────────┘
```

**Why ask the browser for a 16 kHz AudioContext?**  The xAI model's
native rate is 16 kHz. The browser's built-in resampler applies a proper
low-pass filter; naïve JavaScript downsampling introduces aliasing which
degrades ASR quality noticeably on noisy inputs.

**Three-tier transcript state machine** — the UI receives three distinct
events from xAI:

| `is_final` | `speech_final` | Meaning                                    |
|:----------:|:--------------:|--------------------------------------------|
| `false`    | `false`        | Interim (live) — displayed italic grey     |
| `true`     | `false`        | Chunk-final (~3 s locked) — held as pending |
| `true`     | `true`         | Utterance-final — stitched; commits to history |

The chunk-finals are buffered in a `pending` list until the utterance-
final arrives; that utterance-final **replaces** the pending chunks (not
appended to them) — which is how the previous "duplicated sentence" bug
was eliminated.

### Text-to-Speech pipeline

```
┌─ Browser ─────────────────────────────────────────────────────────┐
│                                                                   │
│   textarea value → WebSocket                                      │
│        │                                                          │
│        │  { type: "text.delta", delta: "…" }                      │
│        │  { type: "text.done" }                                   │
│        ▼                                                          │
│   /api/ws/tts  ─►  wss://api.x.ai/v1/tts?voice=…&codec=mp3&…      │
│                                                                   │
│   receives:                                                       │
│     { type: "audio.delta", delta: "<base64 MP3 bytes>" }          │
│     { type: "audio.done", trace_id: "…" }                         │
│                                                                   │
│   decode base64 → Uint8Array → push to array                      │
│   on audio.done → Blob(array, "audio/mpeg") → <audio> element     │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

MP3 is requested (as the xAI docs recommend) because raw PCM over Web
Audio is brittle across browsers — `decodeAudioData` and `<audio>` only
support container formats. MP3 through an `<audio>` element is rock
solid and unlocks free play/pause/seek UI.

### Voice Agent (WebRTC) pipeline

```
┌─ Browser ────────────────────────────────────────────────────────┐
│                                                                  │
│  getUserMedia(24 kHz mono)                                       │
│       │                                                          │
│       ▼                                                          │
│  AudioContext({ sampleRate: 24000 })                             │
│       │                                                          │
│       ├─► pcm-capture worklet  ──► PCM16 chunks (40 ms)          │
│       │                                    │                     │
│       │                                    ▼                     │
│       │                          RTCDataChannel (binary)         │
│       │                                    │                     │
│       │                                    ▼                     │
│       │            ┌─────────────────────────────────────┐       │
│       │            │        server.mjs (werift)          │       │
│       │            │  PCM16 → base64 → xAI Realtime WS   │       │
│       │            │  xAI audio.delta → PCM16 binary     │       │
│       │            └──────────────────┬──────────────────┘       │
│       │                               │                          │
│       │                               ▼                          │
│       │                     wss://api.x.ai/v1/realtime           │
│       │                     ?model=grok-voice-think-fast-1.0     │
│       │                               │                          │
│       ▼                               ▼                          │
│  pcm-playback worklet  ◀── RTCDataChannel (binary, "AUDI" magic) │
│       │                                                          │
│       ▼                                                          │
│  AudioContext output (speakers)                                  │
│                                                                  │
│  JSON control events (session.update, transcripts, VAD, tools,   │
│  function_call_arguments.done, response.create, errors…) flow    │
│  on the SAME DataChannel in both directions as text frames.      │
└──────────────────────────────────────────────────────────────────┘
```

**Why DataChannel and not a media track?**  WebRTC media defaults to
Opus; the xAI realtime API only accepts PCM16 / G.711. A DataChannel
carrying raw PCM16 binary frames is simpler, lossless, and integrates
cleanly with the `input_audio_buffer.append` /
`response.output_audio.delta` event pair.

**Binary-audio optimisation.**  The server strips base64 off incoming
`response.output_audio.delta` events and forwards the raw PCM16 as a
single binary DataChannel frame prefixed with the magic bytes
`"AUDI"` (4 bytes). That saves ~33 % of bandwidth vs. base64 JSON, and
keeps the transcript events small and parseable.

**Interruption / barge-in.**  When the API emits
`input_audio_buffer.speech_started`, the client flushes the playback
worklet's queue so the assistant goes silent instantly.

**Parallel tool calling.**  All `response.function_call_arguments.done`
events are collected during a turn; on `response.done` every function
is executed in parallel, every `function_call_output` is submitted,
and *only then* is a single `response.create` dispatched — exactly
what the xAI best-practices guide recommends.

**Focus mode.**  The orb is a pure `<canvas>` painter: 72 radial
equaliser bars driven by smoothed per-bar targets, a user-mic reactive
outer halo, a multi-stop radial-gradient inner sphere, and three
`orb-ring` CSS keyframes that only render while the assistant is
actually speaking. The transcript state lives in React state
regardless of which view is showing, so toggling modes never drops a
word of the conversation.

---

## Project structure

```
.
├── app/
│   ├── globals.css          # Dark studio theme + orb/bubble keyframes
│   ├── layout.tsx           # Root <html>/<body>, metadata, favicon
│   └── page.tsx             # Renders <VoiceStudio />
│
├── components/
│   ├── VoiceStudio.tsx      # Top-level shell: header, 3-tab toggle, footer
│   ├── SpeechToText.tsx     # Thin wrapper (mic-only)
│   ├── SpeechToTextLive.tsx # Live microphone STT UI
│   ├── TextToSpeech.tsx     # TTS compose panel + MP3 player
│   ├── VoiceAgent.tsx       # Voice Agent shell: WebRTC client + state machine
│   └── agent/
│       ├── AgentOrb.tsx       # Focus-mode canvas visualiser
│       ├── TranscriptView.tsx # Chat-bubble transcript + tool chips
│       └── AgentSettings.tsx  # Model, voice, instructions, VAD, tools
│
├── lib/
│   ├── constants.ts         # Language lists, voices, speech-tag presets,
│   │                        #   agent models, VAD defaults, tool presets
│   ├── utils.ts             # cn(), formatDuration, formatBytes
│   └── rtc-relay.mjs        # Server-side WebRTC ⇄ xAI realtime relay
│
├── public/
│   └── worklets/
│       ├── pcm-capture.js   # AudioWorkletProcessor (Float32 → Int16)
│       └── pcm-playback.js  # Jitter-buffered PCM16 playback worklet
│
├── scripts/
│   ├── test-tts.mjs         # Direct xAI TTS sanity check (saves WAV)
│   └── test-proxy.mjs       # Local /api/ws/tts sanity check
│
├── server.mjs               # Custom Next.js + WS-proxy + RTC signalling
│
├── .env.example             # Template for .env.local
├── .gitignore
├── LICENSE                  # MIT
├── next.config.mjs
├── package.json
├── postcss.config.mjs
├── tailwind.config.ts
└── tsconfig.json
```

---

## API endpoints

### HTTP

| Route     | Purpose                         |
| --------- | ------------------------------- |
| `GET /`   | The Voice Studio SPA.           |

### WebSocket

| Route              | Proxies to                     | Direction    |
| ------------------ | ------------------------------ | ------------ |
| `/api/ws/stt`      | `wss://api.x.ai/v1/stt`        | bidirectional |
| `/api/ws/tts`      | `wss://api.x.ai/v1/tts`        | bidirectional |

Both WebSocket endpoints whitelist only the query parameters documented
by xAI and forward them verbatim.

### WebRTC signalling

| Route                            | Method   | Purpose                                           |
| -------------------------------- | -------- | ------------------------------------------------- |
| `/api/rtc/offer`                 | `POST`   | Browser sends SDP offer; server returns SDP answer, opens its own WebSocket to `wss://api.x.ai/v1/realtime`, and establishes a DataChannel relay. |
| `/api/rtc/session/:id`           | `DELETE` | Cleanly tear down a session (closes peer + upstream WS). |

See the xAI docs for the full protocol references:

- Speech-to-Text: <https://docs.x.ai/developers/model-capabilities/audio/speech-to-text>
- Text-to-Speech: <https://docs.x.ai/developers/model-capabilities/audio/text-to-speech>
- Voice Agent: <https://docs.x.ai/developers/model-capabilities/audio/voice-agent>

---

## Development scripts

Two diagnostic scripts are provided to isolate issues when things go
wrong — run them with plain `node`, no build step required.

### `scripts/test-tts.mjs`

Opens a WebSocket straight to `wss://api.x.ai/v1/tts`, sends text, writes
the returned audio to `test-tts.wav`. Use this to confirm your API key
works and the xAI service is healthy independently of the UI.

```bash
node scripts/test-tts.mjs "Hello from Grok." eve en
# → Saved test-tts.wav — 252,960 PCM bytes, 5.27s audio, 2.8s total
```

### `scripts/test-proxy.mjs`

Same as above, but against your local `/api/ws/tts` proxy. Confirms the
Node server is forwarding correctly. Requires `npm run dev` running.

```bash
node scripts/test-proxy.mjs
```

---

## Production notes

- The server is a plain Node.js process — deploy it anywhere that runs
  Node 18+ (a VPS, Docker, Fly.io, Railway, Render, bare-metal…).
- **Vercel's default serverless runtime does NOT support long-lived
  WebSockets.** Use Vercel's dedicated Node runtime or host elsewhere.
  Recommended alternatives: Fly.io, Railway, Render, Cloud Run, or a VPS
  with Nginx reverse-proxying WebSocket upgrades.
- Put the service behind HTTPS in production. Browsers require
  `getUserMedia` to be called from a secure context (HTTPS or
  `localhost`).
- Set `NODE_ENV=production` — Next.js serves prebuilt assets and the
  server skips dev-only WebSocket upgrade forwarding.
- xAI enforces **50 concurrent streaming sessions per team** — for
  high-throughput services, pool or queue requests.

---

## Security

- Your `XAI_API_KEY` is read **server-side only** (`process.env` inside
  `server.mjs`). It is never serialised into the client bundle, never
  sent as a WebSocket query parameter to the browser, and never echoed
  in responses.
- The WebSocket proxy **whitelists** each xAI query parameter before
  forwarding — arbitrary client-supplied params are silently dropped.
- Audio and transcripts are **not logged** by the server. Only session
  lifecycle events (open / close / error) and message counts are logged.
- `.env` and `.env.local` are both git-ignored (see `.gitignore`).
  Generated audio artefacts (`test-tts.wav`, `*.tmp.mp3`) are also
  ignored so you can't accidentally commit local test output.

If you discover a security issue, please open a private disclosure on
GitHub rather than a public issue.

---

## Tech stack

- **Next.js 14** (App Router) + **React 18** + **TypeScript**
- **Tailwind CSS 3** for styling
- **ws** (WebSocket server in Node)
- **werift** (pure-JS WebRTC stack for the Voice Agent relay)
- **AudioWorklet** for low-latency PCM capture & playback
- **Web Audio API** for both mic capture (24 kHz mono) and streaming
  playback (jitter-buffered PCM16 queue)
- **WebRTC DataChannel** for bidirectional audio + control
- **lucide-react** for icons

---

## Troubleshooting

<details>
<summary><b>Page reload shows a grid, then content fades in</b></summary>

The ambient grid backdrop is drawn by CSS on the `body::before`
pseudo-element. The previous version of this project used entrance
animations which made it visible briefly on every reload. Current
releases render instantly. If you still see a flash, hard-refresh
(Ctrl+Shift+R) to bust the cached CSS.
</details>

<details>
<summary><b>"TTS not working" / silent audio</b></summary>

1. Click **Generate & play** on a small sample ("hello"). Wait ~2 s.
2. Check the progress bar and `chunks · bytes` counter below it. If it
   updates, audio is arriving; the issue is playback.
3. Check the browser tab is not muted and OS output device is correct.
4. Open DevTools → Network → WS to verify the `/api/ws/tts` frame flow.
5. Run `node scripts/test-tts.mjs` — if that produces `test-tts.wav`,
   your key and xAI are fine and the issue is UI-side.
</details>

<details>
<summary><b>STT accuracy issues</b></summary>

- Enable **Text formatting** with your target language for cleaner
  number / date output.
- Say ambiguous phrases clearly, e.g. say *"three three three"* rather
  than *"triple three"* (ASR models don't normalize colloquialisms like
  "triple", "double-oh").
- Reduce background noise — the mic is captured with echo-cancellation
  and noise-suppression on, but a fundamentally noisy environment still
  hurts accuracy.
</details>

<details>
<summary><b>EADDRINUSE on <code>npm run dev</code></b></summary>

A previous dev-server instance is still holding port 3000. On Windows:

```powershell
$pids = netstat -ano | Select-String ":3000 " | Select-String "LISTENING" | `
        ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
$pids | ForEach-Object { Stop-Process -Id $_ -Force }
```

macOS / Linux:

```bash
lsof -ti:3000 | xargs kill -9
```

If you see a lot of stale Node processes (because of interrupted
builds), a nuclear option is `taskkill /F /IM node.exe` on Windows or
`pkill -9 node` elsewhere.
</details>

<details>
<summary><b>Next.js dev server hangs silently after the banner</b></summary>

Windows file locks on `.next/cache/` are the usual cause. Delete
`.next/` and try again:

```bash
rm -rf .next   # or: Remove-Item -Recurse -Force .next
npm run dev
```
</details>

---

## Credits & License

Built by **Ashutosh Shrivastava** — [@ai_for_success](https://x.com/ai_for_success).

Released under the [MIT License](LICENSE).

---

## Related reading

- [xAI — Introducing Grok STT & TTS APIs](https://x.ai/news/grok-speech-to-text-text-to-speech)
- [xAI Speech-to-Text docs](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text)
- [xAI Text-to-Speech docs](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech)
- [xAI Console (get an API key)](https://console.x.ai)
