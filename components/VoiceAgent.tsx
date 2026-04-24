"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Loader2,
  AlertCircle,
  Maximize2,
  Minimize2,
  Wifi,
  Activity,
} from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import {
  AGENT_BUILTIN_FUNCTIONS,
  AGENT_SAMPLE_RATE,
} from "@/lib/constants";
import AgentOrb, { type OrbState } from "./agent/AgentOrb";
import TranscriptView, {
  type TranscriptMessage,
  type ToolCallEntry,
} from "./agent/TranscriptView";
import AgentSettings, {
  DEFAULT_AGENT_SETTINGS,
  type AgentSettingsState,
} from "./agent/AgentSettings";

type ConnStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "closing"
  | "closed"
  | "error";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// Marker bytes the server prepends to audio binary frames (see
// lib/rtc-relay.mjs). Anything without this prefix is treated as a
// generic binary event (reserved for future use).
const AUDIO_MAGIC = [0x41, 0x55, 0x44, 0x49]; // "AUDI"

export default function VoiceAgent() {
  const [settings, setSettings] = useState<AgentSettingsState>(
    DEFAULT_AGENT_SETTINGS
  );
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [focusMode, setFocusMode] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  // In a live call we take over the full viewport. When the call ends
  // we drop back to the normal 2-column layout so the user can see the
  // transcript and tweak settings.
  const [fullscreenTranscriptOpen, setFullscreenTranscriptOpen] =
    useState(false);

  // Transcript state — a live log of messages.
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);

  // Orb state (drives the visualiser)
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [userLevel, setUserLevel] = useState(0);
  const [assistantLevel, setAssistantLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);

  // Refs that drive the WebRTC pipeline
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<AudioWorkletNode | null>(null);
  const playbackRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const mutedRef = useRef(muted);
  const settingsRef = useRef(settings);
  // Set to true once we've *sent* session.update (so we don't send it twice).
  const sessionUpdateSentRef = useRef(false);
  // Set to true once xAI confirms with session.updated — gates audio forwarding.
  const sessionReadyRef = useRef(false);

  // Accumulators for streaming transcripts.
  const currentUserItemRef = useRef<string | null>(null);
  const currentAssistantItemRef = useRef<string | null>(null);

  // Pending tool calls (collected during a response; flushed on response.done).
  const pendingCallsRef = useRef<
    Map<string, { name: string; arguments: string }>
  >(new Map());

  useEffect(() => {
    mutedRef.current = muted;
    const cap = captureRef.current;
    if (cap) cap.port.postMessage({ type: "mute", value: muted });
  }, [muted]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Elapsed timer while a session is live.
  useEffect(() => {
    if (status !== "ready") return;
    const t = setInterval(() => {
      setElapsed((Date.now() - startedAtRef.current) / 1000);
    }, 250);
    return () => clearInterval(t);
  }, [status]);

  const pushMessage = useCallback((m: TranscriptMessage) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const updateAssistantText = useCallback(
    (itemId: string, delta: string, final = false) => {
      setMessages((prev) => {
        const idx = [...prev]
          .reverse()
          .findIndex((m) => m.kind === "assistant" && m.id === itemId);
        if (idx === -1) {
          return [
            ...prev,
            { kind: "assistant", id: itemId, text: delta, final },
          ];
        }
        const realIdx = prev.length - 1 - idx;
        const next = prev.slice();
        const existing = next[realIdx] as Extract<
          TranscriptMessage,
          { kind: "assistant" }
        >;
        next[realIdx] = {
          ...existing,
          text: final ? delta : existing.text + delta,
          final,
        };
        return next;
      });
    },
    []
  );

  const updateUserText = useCallback(
    (itemId: string, text: string, final = true) => {
      setMessages((prev) => {
        const idx = [...prev]
          .reverse()
          .findIndex((m) => m.kind === "user" && m.id === itemId);
        if (idx === -1) {
          return [...prev, { kind: "user", id: itemId, text, final }];
        }
        const realIdx = prev.length - 1 - idx;
        const next = prev.slice();
        next[realIdx] = {
          kind: "user",
          id: itemId,
          text,
          final,
        };
        return next;
      });
    },
    []
  );

  const upsertToolChip = useCallback((entry: ToolCallEntry) => {
    setMessages((prev) => {
      const existingIdx = prev.findIndex(
        (m) => m.kind === "tool" && m.entry.id === entry.id
      );
      if (existingIdx !== -1) {
        // Already in the list — just update in place (e.g. calling → ok).
        const next = prev.slice();
        next[existingIdx] = { kind: "tool", id: entry.id, entry };
        return next;
      }
      // New chip. xAI's server-side tools (web_search, x_search) emit
      // `response.function_call_arguments.done` *after* the assistant's
      // audio has already started streaming, so naive append makes the
      // chip look like it happened AFTER the answer. Walk backwards from
      // the end of the list until we hit the latest assistant message of
      // the current turn (i.e. not crossing a user message) and insert
      // the chip just before it — so the transcript reads:
      //   user  →  🔧 tool  →  assistant answer
      for (let i = prev.length - 1; i >= 0; i--) {
        const m = prev[i];
        if (m.kind === "user") break;
        if (m.kind === "assistant") {
          const next = prev.slice();
          next.splice(i, 0, { kind: "tool", id: entry.id, entry });
          return next;
        }
      }
      return [...prev, { kind: "tool", id: entry.id, entry }];
    });
  }, []);

  const teardown = useCallback(async () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    try {
      captureRef.current?.port.close();
      captureRef.current?.disconnect();
    } catch {}
    captureRef.current = null;

    try {
      playbackRef.current?.disconnect();
    } catch {}
    playbackRef.current = null;

    try {
      analyserRef.current?.disconnect();
    } catch {}
    analyserRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    try {
      await audioCtxRef.current?.close();
    } catch {}
    audioCtxRef.current = null;

    try {
      dcRef.current?.close();
    } catch {}
    dcRef.current = null;

    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    if (sessionIdRef.current) {
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      fetch(`/api/rtc/session/${id}`, { method: "DELETE" }).catch(() => {});
    }

    sessionUpdateSentRef.current = false;
    sessionReadyRef.current = false;
    pendingCallsRef.current.clear();
    currentUserItemRef.current = null;
    currentAssistantItemRef.current = null;
    setUserLevel(0);
    setAssistantLevel(0);
    setSpeaking(false);
    setListening(false);
    setOrbState("idle");
  }, []);

  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  const sendJson = useCallback((payload: unknown) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          "[agent] sendJson: DC not open (state =",
          dc?.readyState,
          ")",
          payload
        );
      }
      return;
    }
    try {
      dc.send(JSON.stringify(payload));
      if (process.env.NODE_ENV !== "production") {
        const t = (payload as { type?: string })?.type;
        // eslint-disable-next-line no-console
        console.log("[agent →]", t, payload);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[agent] dc send failed", err);
    }
  }, []);

  const buildSessionConfig = useCallback(
    (s: AgentSettingsState) => {
      type ToolDef =
        | { type: "web_search" }
        | { type: "x_search"; allowed_x_handles?: string[] }
        | {
            type: "function";
            name: string;
            description: string;
            parameters: Record<string, unknown>;
          };
      const tools: ToolDef[] = [];
      if (s.tools.web_search) tools.push({ type: "web_search" });
      if (s.tools.x_search) {
        const handles = s.tools.x_handles
          .split(/[,\s]+/)
          .map((h) => h.trim().replace(/^@/, ""))
          .filter(Boolean);
        tools.push({
          type: "x_search",
          ...(handles.length ? { allowed_x_handles: handles } : {}),
        });
      }
      for (const fn of AGENT_BUILTIN_FUNCTIONS) {
        if ((s.tools as Record<string, unknown>)[fn.name]) {
          tools.push({
            type: "function",
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters,
          });
        }
      }
      return {
        type: "session.update",
        session: {
          instructions: s.instructions,
          voice: s.voice,
          turn_detection: {
            type: "server_vad",
            threshold: s.vad.threshold,
            silence_duration_ms: s.vad.silence_duration_ms,
            prefix_padding_ms: s.vad.prefix_padding_ms,
          },
          audio: {
            input: {
              format: { type: "audio/pcm", rate: AGENT_SAMPLE_RATE },
            },
            output: {
              format: { type: "audio/pcm", rate: AGENT_SAMPLE_RATE },
            },
          },
          ...(tools.length ? { tools } : {}),
        },
      };
    },
    []
  );

  // --- Tool execution ---
  const executeFunctionCall = useCallback(
    async (name: string, argsJson: string) => {
      const fn = AGENT_BUILTIN_FUNCTIONS.find((f) => f.name === name);
      if (!fn) {
        return { error: `Unknown function ${name}` };
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = argsJson ? JSON.parse(argsJson) : {};
      } catch {
        return { error: "Invalid JSON arguments" };
      }
      try {
        return fn.mock(parsed) as unknown;
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    []
  );

  const flushPendingToolCalls = useCallback(async () => {
    if (pendingCallsRef.current.size === 0) return;
    const calls = Array.from(pendingCallsRef.current.entries());
    pendingCallsRef.current.clear();

    // Execute in parallel.
    const results = await Promise.all(
      calls.map(async ([callId, { name, arguments: argsJson }]) => {
        upsertToolChip({
          id: callId,
          tool: name,
          label: "calling",
          args: argsJson,
          status: "calling",
        });
        const output = await executeFunctionCall(name, argsJson);
        upsertToolChip({
          id: callId,
          tool: name,
          label: "ok",
          args: argsJson,
          output: JSON.stringify(output),
          status: "done",
        });
        return { callId, output };
      })
    );

    for (const { callId, output } of results) {
      sendJson({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(output),
        },
      });
    }
    sendJson({ type: "response.create" });
  }, [executeFunctionCall, sendJson, upsertToolChip]);

  // --- Event router for xAI events arriving over DataChannel ---
  const handleEvent = useCallback(
    (event: Record<string, unknown> & { type: string }) => {
      const type = event.type;
      // eslint-disable-next-line no-console
      if (process.env.NODE_ENV !== "production") {
        const isChatty =
          type === "response.output_audio.delta" ||
          type === "response.output_audio_transcript.delta" ||
          type === "response.audio_transcript.delta";
        if (!isChatty) {
          // eslint-disable-next-line no-console
          console.log("[agent evt]", type, event);
        }
      }
      switch (type) {
        // xAI emits `conversation.created` as the first event on a new
        // realtime socket (matching their cookbook implementation), whereas
        // the OpenAI-spec `session.created` is *not* emitted by xAI. We
        // handle both so we're spec-agnostic.
        case "conversation.created":
        case "session.created": {
          // The session exists — flip the UI to ready so the Connecting
          // button resolves even if session.updated takes a while.
          setStatus((prev) => (prev === "connecting" ? "ready" : prev));
          if (!startedAtRef.current) startedAtRef.current = Date.now();
          setOrbState((prev) =>
            prev === "connecting" ? "listening" : prev
          );
          if (!sessionUpdateSentRef.current) {
            sessionUpdateSentRef.current = true;
            sendJson(buildSessionConfig(settingsRef.current));
          }
          break;
        }
        case "session.updated": {
          sessionReadyRef.current = true;
          setStatus("ready");
          if (!startedAtRef.current) startedAtRef.current = Date.now();
          setOrbState((prev) =>
            prev === "connecting" || prev === "idle" ? "listening" : prev
          );
          break;
        }
        // xAI sends keep-alive `ping` frames; respond with `pong` so the
        // upstream doesn't eventually consider us dead.
        case "ping": {
          sendJson({ type: "pong" });
          break;
        }
        case "input_audio_buffer.speech_started": {
          setListening(true);
          setOrbState("listening");
          // If the assistant was speaking, the server will auto-cancel it —
          // flush our local playback queue so we're not talking over silence.
          playbackRef.current?.port.postMessage({ type: "clear" });
          break;
        }
        case "input_audio_buffer.speech_stopped": {
          setListening(false);
          setOrbState("thinking");
          break;
        }
        case "conversation.item.input_audio_transcription.completed": {
          const itemId = String((event as { item_id?: string }).item_id || "");
          const transcript = String(
            (event as { transcript?: string }).transcript || ""
          ).trim();
          if (itemId && transcript) {
            updateUserText(itemId, transcript, true);
          }
          break;
        }
        case "response.created": {
          setOrbState("thinking");
          break;
        }
        case "response.output_item.added": {
          const item = (event as { item?: { id?: string; type?: string } })
            .item;
          if (item?.type === "message" && item.id) {
            currentAssistantItemRef.current = item.id;
            updateAssistantText(item.id, "", false);
          } else if (item?.type === "function_call") {
            // Will fill in at function_call_arguments.done
          }
          break;
        }
        case "response.output_audio_transcript.delta":
        case "response.audio_transcript.delta": {
          const itemId = String(
            (event as { item_id?: string }).item_id ||
              currentAssistantItemRef.current ||
              ""
          );
          const delta = String((event as { delta?: string }).delta || "");
          if (itemId && delta) {
            updateAssistantText(itemId, delta, false);
          }
          break;
        }
        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done": {
          const itemId = String(
            (event as { item_id?: string }).item_id ||
              currentAssistantItemRef.current ||
              ""
          );
          const text = String(
            (event as { transcript?: string }).transcript || ""
          );
          if (itemId) updateAssistantText(itemId, text, true);
          break;
        }
        case "response.text.delta":
        case "response.output_text.delta": {
          const itemId = String(
            (event as { item_id?: string }).item_id ||
              currentAssistantItemRef.current ||
              ""
          );
          const delta = String((event as { delta?: string }).delta || "");
          if (itemId && delta) updateAssistantText(itemId, delta, false);
          break;
        }
        case "response.function_call_arguments.done": {
          const callId = String((event as { call_id?: string }).call_id || "");
          const name = String((event as { name?: string }).name || "");
          const args = String(
            (event as { arguments?: string }).arguments || "{}"
          );
          if (callId && name) {
            pendingCallsRef.current.set(callId, { name, arguments: args });
            upsertToolChip({
              id: callId,
              tool: name,
              label: "queued",
              args,
              status: "calling",
            });
          }
          break;
        }
        case "response.output_audio.delta": {
          // Only the lightweight meta event (no audio payload) arrives as JSON.
          setSpeaking(true);
          setOrbState("speaking");
          break;
        }
        case "response.output_audio.done": {
          setSpeaking(false);
          break;
        }
        case "response.done": {
          // Flush any pending tool calls and ask for continuation.
          void flushPendingToolCalls().then(() => {
            setOrbState((prev) =>
              prev === "thinking" ? "listening" : prev
            );
          });
          if (pendingCallsRef.current.size === 0) {
            setOrbState((prev) =>
              prev === "thinking" || prev === "speaking"
                ? "listening"
                : prev
            );
          }
          break;
        }
        case "error": {
          const err = (event as { error?: { message?: string } }).error;
          const message = err?.message || "Unknown error from xAI";
          setError(message);
          setOrbState("error");
          pushMessage({
            kind: "system",
            id: `err-${Date.now()}`,
            text: message,
          });
          break;
        }
        default:
          break;
      }
    },
    [
      buildSessionConfig,
      flushPendingToolCalls,
      pushMessage,
      sendJson,
      updateAssistantText,
      updateUserText,
      upsertToolChip,
    ]
  );

  // --- Start a session ---
  const start = useCallback(async () => {
    setError(null);
    setMessages([]);
    setElapsed(0);
    setStatus("connecting");
    setOrbState("connecting");

    // --- Audio setup (in parallel with WebRTC setup) ---
    const AudioCtor: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    let audioCtx: AudioContext;
    try {
      audioCtx = new AudioCtor({ sampleRate: AGENT_SAMPLE_RATE });
    } catch {
      audioCtx = new AudioCtor();
    }
    audioCtxRef.current = audioCtx;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      setError(
        "Microphone permission denied. Allow microphone access and try again."
      );
      setStatus("error");
      setOrbState("error");
      await teardown();
      return;
    }
    streamRef.current = stream;

    try {
      await audioCtx.audioWorklet.addModule("/worklets/pcm-capture.js");
      await audioCtx.audioWorklet.addModule("/worklets/pcm-playback.js");
    } catch (err) {
      setError("Failed to load audio worklets.");
      setStatus("error");
      setOrbState("error");
      await teardown();
      return;
    }

    const source = audioCtx.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(audioCtx, "pcm-capture", {
      processorOptions: { chunkMs: 40 }, // low-latency chunks
    });
    captureRef.current = capture;

    const playback = new AudioWorkletNode(audioCtx, "pcm-playback", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    playback.connect(audioCtx.destination);
    playbackRef.current = playback;
    playback.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "level") {
        setAssistantLevel(msg.rms || 0);
      } else if (msg.type === "started") {
        setSpeaking(true);
        setOrbState("speaking");
      } else if (msg.type === "stopped") {
        setSpeaking(false);
      }
    };

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyserRef.current = analyser;
    source.connect(analyser);
    source.connect(capture);

    // --- WebRTC setup ---
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    const dc = pc.createDataChannel("xai-voice", { ordered: true });
    dcRef.current = dc;
    dc.binaryType = "arraybuffer";

    capture.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      // Only forward audio once xAI has confirmed session.updated —
      // otherwise it might get processed under default formats before our
      // session configuration is applied.
      if (
        dc.readyState === "open" &&
        sessionReadyRef.current &&
        !mutedRef.current
      ) {
        try {
          dc.send(e.data);
        } catch {}
      }
    };

    dc.onopen = () => {
      // session.created will arrive next; our handler will send session.update.
    };
    dc.onclose = () => {
      setStatus((s) => (s === "error" ? s : "closed"));
    };
    dc.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const view = new Uint8Array(event.data);
        if (
          view.length >= 4 &&
          view[0] === AUDIO_MAGIC[0] &&
          view[1] === AUDIO_MAGIC[1] &&
          view[2] === AUDIO_MAGIC[2] &&
          view[3] === AUDIO_MAGIC[3]
        ) {
          const pcm = event.data.slice(4);
          playbackRef.current?.port.postMessage(
            { buffer: pcm },
            [pcm]
          );
        }
        return;
      }
      try {
        const evt = JSON.parse(String(event.data));
        handleEvent(evt);
      } catch (err) {
        console.warn("bad event", event.data, err);
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "failed" || s === "disconnected") {
        setStatus((prev) => (prev === "ready" ? "closed" : prev));
      }
    };

    // Create offer, wait for ICE gathering (non-trickle), then POST.
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    let data: { sessionId: string; sdp: string; type: string };
    try {
      const resp = await fetch("/api/rtc/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdp: pc.localDescription?.sdp,
          model: settingsRef.current.model,
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Signalling failed: HTTP ${resp.status} — ${t}`);
      }
      data = await resp.json();
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
      setOrbState("error");
      await teardown();
      return;
    }

    sessionIdRef.current = data.sessionId;
    try {
      await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
    } catch (err) {
      setError("Failed to set remote SDP: " + (err as Error).message);
      setStatus("error");
      setOrbState("error");
      await teardown();
      return;
    }

    // Mic level meter (user side)
    const tickData = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(tickData);
      let sum = 0;
      for (let i = 0; i < tickData.length; i++) {
        const v = (tickData[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / tickData.length);
      setUserLevel(Math.min(1, rms * 3));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, [handleEvent, teardown]);

  // Live-update session when settings change mid-conversation.
  useEffect(() => {
    if (status !== "ready" || !sessionUpdateSentRef.current) return;
    sendJson(buildSessionConfig(settings));
  }, [buildSessionConfig, sendJson, settings, status]);

  const end = useCallback(async () => {
    setStatus("closing");
    await teardown();
    setStatus("closed");
    setFullscreenTranscriptOpen(false);
    // After a call, drop back into transcript mode so the user can read
    // what was just said (if there's anything to read).
    setFocusMode((prev) => {
      return prev;
    });
  }, [teardown]);

  const canStart = status === "idle" || status === "closed" || status === "error";
  const isActive = status === "connecting" || status === "ready";

  return (
    <>
      {isActive && (
        <FullscreenCall
          orbState={orbState}
          assistantLevel={assistantLevel}
          userLevel={userLevel}
          status={status}
          muted={muted}
          onMute={() => setMuted((m) => !m)}
          onEnd={end}
          elapsed={elapsed}
          messages={messages}
          speaking={speaking}
          transcriptOpen={fullscreenTranscriptOpen}
          onToggleTranscript={() =>
            setFullscreenTranscriptOpen((v) => !v)
          }
          error={error}
        />
      )}
    <div
      className={cn(
        "grid lg:grid-cols-[1fr_300px] gap-4 md:gap-5 h-full min-h-0",
        // Keep the normal layout mounted (so transcript state persists),
        // but hide it behind the fullscreen overlay.
        isActive && "invisible pointer-events-none"
      )}
    >
      {/* Conversation panel — flips between transcript and focus orb */}
      <div className="card p-0 overflow-hidden flex flex-col min-h-0 lg:h-full">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <StatusPill status={status} orbState={orbState} />
            <span className="text-sm font-medium">
              {statusLabel(status, orbState)}
            </span>
            {isActive && (
              <span className="chip bg-white/5 text-ink-300 font-mono">
                {formatDuration(elapsed)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost text-xs"
              onClick={() => setFocusMode((f) => !f)}
              title={focusMode ? "Show transcript" : "Focus mode"}
            >
              {focusMode ? (
                <>
                  <Minimize2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Transcript</span>
                </>
              ) : (
                <>
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Focus</span>
                </>
              )}
            </button>
            <Transport
              status={status}
              muted={muted}
              onStart={start}
              onEnd={end}
              onMute={() => setMuted((m) => !m)}
              compact
              headerVariant
            />
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-200">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 min-h-0 relative">
          {/* Focus (orb) view — keeps transcript state in memory behind the scenes */}
          <div
            className={cn(
              "absolute inset-0 flex flex-col transition-opacity duration-500",
              focusMode ? "opacity-100 view-enter" : "pointer-events-none opacity-0"
            )}
            aria-hidden={!focusMode}
          >
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4 px-4">
              <AgentOrb
                state={isActive ? orbState : "idle"}
                assistantLevel={assistantLevel}
                userLevel={userLevel}
                size={260}
              />
              <div className="mt-4 flex flex-col items-center gap-1.5 min-h-[48px]">
                <span className="text-[11px] uppercase tracking-[0.25em] text-ink-300 font-medium">
                  {orbLabel(isActive ? orbState : "idle")}
                </span>
                {orbState === "thinking" ? (
                  <div className="flex items-center gap-1">
                    <span className="typing-dot typing-dot-1 inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                    <span className="typing-dot typing-dot-2 inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                    <span className="typing-dot typing-dot-3 inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                  </div>
                ) : (
                  <span className="text-[13px] text-ink-400 max-w-sm text-center leading-relaxed">
                    {subtitleFor(status, orbState, muted)}
                  </span>
                )}
              </div>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFocusMode(false)}
                  className="mt-2 text-[11px] uppercase tracking-[0.2em] text-ink-400 hover:text-ink-100 transition-colors"
                >
                  {messages.length} message{messages.length === 1 ? "" : "s"} · view transcript →
                </button>
              )}
            </div>

            {isActive && (
              <div className="shrink-0 px-5 py-3 border-t border-white/5 bg-white/[0.02] flex items-center justify-center">
                <button
                  onClick={() => setMuted((m) => !m)}
                  className={cn(
                    "btn",
                    muted
                      ? "bg-red-500/15 text-red-300 border border-red-500/25"
                      : "bg-white/[0.06] text-ink-100 border border-white/[0.08]",
                    "px-4 py-2 text-[13px]"
                  )}
                  title={muted ? "Unmute" : "Mute"}
                >
                  {muted ? (
                    <>
                      <MicOff className="h-4 w-4" /> Muted
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4" /> Mic on
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Transcript view */}
          <div
            className={cn(
              "absolute inset-0 flex flex-col transition-opacity duration-500",
              !focusMode ? "opacity-100 view-enter" : "pointer-events-none opacity-0"
            )}
            aria-hidden={focusMode}
          >
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4 md:p-5">
              <TranscriptView
                messages={messages}
                isThinking={orbState === "thinking" && !speaking}
              />
            </div>

            {/* Mini-orb + transport pinned to bottom in transcript mode */}
            <div className="shrink-0 border-t border-white/5 px-5 py-3 flex items-center justify-between gap-3 bg-white/[0.02]">
              <div className="flex items-center gap-3 min-w-0">
                <AgentOrb
                  state={isActive ? orbState : "idle"}
                  assistantLevel={assistantLevel}
                  userLevel={userLevel}
                  size={48}
                />
                <LevelMeter level={userLevel} active={listening && !muted} />
              </div>
              <Transport
                status={status}
                muted={muted}
                onStart={start}
                onEnd={end}
                onMute={() => setMuted((m) => !m)}
                compact
              />
            </div>
          </div>
        </div>
      </div>

      {/* Settings panel */}
      <aside className="card p-4 lg:h-full min-h-0 flex flex-col">
        <AgentSettings
          value={settings}
          onChange={setSettings}
          locked={false}
        />
      </aside>
    </div>
    </>
  );
}

function FullscreenCall({
  orbState,
  assistantLevel,
  userLevel,
  status,
  muted,
  onMute,
  onEnd,
  elapsed,
  messages,
  speaking,
  transcriptOpen,
  onToggleTranscript,
  error,
}: {
  orbState: OrbState;
  assistantLevel: number;
  userLevel: number;
  status: ConnStatus;
  muted: boolean;
  onMute: () => void;
  onEnd: () => void;
  elapsed: number;
  messages: TranscriptMessage[];
  speaking: boolean;
  transcriptOpen: boolean;
  onToggleTranscript: () => void;
  error: string | null;
}) {
  const isConnecting = status === "connecting";
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-between overflow-hidden view-enter"
      style={{
        background:
          "radial-gradient(1100px 700px at 50% 40%, rgba(139,92,246,0.18), transparent 65%), radial-gradient(800px 500px at 20% 90%, rgba(201,242,108,0.10), transparent 60%), radial-gradient(900px 600px at 85% 10%, rgba(255,107,53,0.08), transparent 60%), #050608",
      }}
    >
      {/* Top bar — status + elapsed + transcript toggle */}
      <div className="shrink-0 w-full px-6 md:px-10 pt-5 pb-2 flex items-center justify-between text-ink-300">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em]">
          <span
            className={cn(
              "inline-flex h-2 w-2 rounded-full",
              isConnecting
                ? "bg-amber-300 animate-pulse"
                : orbState === "speaking"
                ? "bg-accent-orange rec-dot"
                : orbState === "thinking"
                ? "bg-accent"
                : "bg-accent-lime rec-dot"
            )}
          />
          {isConnecting ? "Connecting" : "Live"}
          <span className="text-ink-500">·</span>
          <span className="font-mono text-ink-200">
            {formatDuration(elapsed)}
          </span>
        </div>
        <button
          onClick={onToggleTranscript}
          className={cn(
            "btn-ghost text-xs",
            transcriptOpen && "bg-white/[0.06] text-ink-50"
          )}
          title={transcriptOpen ? "Hide transcript" : "Show transcript"}
        >
          <Maximize2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">
            {transcriptOpen ? "Hide" : "Transcript"}
          </span>
          {messages.length > 0 && !transcriptOpen && (
            <span className="ml-1 text-[10px] font-mono text-ink-400">
              {messages.length}
            </span>
          )}
        </button>
      </div>

      {/* Orb area — absolutely centred in the viewport */}
      <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-4 px-6">
        <AgentOrb
          state={orbState}
          assistantLevel={assistantLevel}
          userLevel={userLevel}
          size={340}
        />
        <div className="mt-6 flex flex-col items-center gap-2 min-h-[60px]">
          <span className="text-[12px] uppercase tracking-[0.3em] text-ink-200 font-medium">
            {orbLabel(orbState)}
          </span>
          {orbState === "thinking" ? (
            <div className="flex items-center gap-1.5">
              <span className="typing-dot typing-dot-1 inline-block h-2 w-2 rounded-full bg-accent" />
              <span className="typing-dot typing-dot-2 inline-block h-2 w-2 rounded-full bg-accent" />
              <span className="typing-dot typing-dot-3 inline-block h-2 w-2 rounded-full bg-accent" />
            </div>
          ) : (
            <span className="text-[14px] text-ink-400 max-w-md text-center leading-relaxed">
              {subtitleFor(status, orbState, muted)}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="shrink-0 max-w-md mx-6 mb-3 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-200">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Controls — Mute + End */}
      <div className="shrink-0 pb-10 md:pb-12 flex flex-col items-center gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onMute}
            className={cn(
              "relative h-14 w-14 rounded-full flex items-center justify-center transition-all",
              muted
                ? "bg-red-500/20 text-red-200 border border-red-500/30 shadow-[0_6px_20px_-6px_rgba(239,68,68,0.5)]"
                : "bg-white/[0.06] text-ink-100 border border-white/[0.1] hover:bg-white/[0.1]"
            )}
            title={muted ? "Unmute" : "Mute"}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </button>

          <button
            onClick={onEnd}
            disabled={status === "closing"}
            className={cn(
              "relative h-16 w-16 rounded-full flex items-center justify-center transition-all",
              "bg-red-500 text-white",
              "hover:bg-red-500/90 active:scale-95",
              "shadow-[0_10px_40px_-6px_rgba(239,68,68,0.55)]",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            title="End call"
            aria-label="End call"
          >
            {isConnecting ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <PhoneOff className="h-6 w-6" />
            )}
          </button>
        </div>
        <span className="text-[11px] uppercase tracking-[0.25em] text-ink-500">
          {isConnecting ? "Cancel" : "End call"}
        </span>
      </div>

      {/* Transcript slide-up sheet */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-10",
          "transition-transform duration-300 ease-out",
          transcriptOpen
            ? "translate-y-0"
            : "translate-y-full pointer-events-none"
        )}
        style={{ height: "60vh" }}
        aria-hidden={!transcriptOpen}
      >
        <div
          className="h-full mx-auto max-w-3xl rounded-t-3xl overflow-hidden"
          style={{
            background: "rgba(10, 11, 14, 0.92)",
            backdropFilter: "blur(22px)",
            WebkitBackdropFilter: "blur(22px)",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 -24px 60px -12px rgba(0,0,0,0.6)",
          }}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <div className="h-1 w-10 rounded-full bg-white/20" />
              <span className="text-[11px] uppercase tracking-wider text-ink-400 ml-2">
                Live transcript
              </span>
            </div>
            <button
              onClick={onToggleTranscript}
              className="btn-ghost text-xs"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Hide</span>
            </button>
          </div>
          <div className="h-[calc(100%-45px)] overflow-y-auto scrollbar-thin p-4 md:p-5">
            <TranscriptView
              messages={messages}
              isThinking={orbState === "thinking" && !speaking}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Transport({
  status,
  muted,
  onStart,
  onEnd,
  onMute,
  compact,
  headerVariant,
}: {
  status: ConnStatus;
  muted: boolean;
  onStart: () => void;
  onEnd: () => void;
  onMute: () => void;
  compact?: boolean;
  headerVariant?: boolean;
}) {
  const isActive = status === "connecting" || status === "ready";
  const isConnecting = status === "connecting";
  const idle = status === "idle" || status === "closed" || status === "error";

  // Header variant: a single compact pill — no mute, no extra label.
  // Designed to sit next to the Transcript toggle.
  if (headerVariant) {
    if (idle) {
      return (
        <button
          onClick={onStart}
          className="btn-primary px-3 py-1.5 text-xs"
          title="Start conversation"
        >
          <Phone className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Start</span>
        </button>
      );
    }
    return (
      <button
        onClick={onEnd}
        disabled={status === "closing"}
        className="btn-danger px-3 py-1.5 text-xs"
        title="End conversation"
      >
        {isConnecting ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="hidden sm:inline">Connecting…</span>
          </>
        ) : (
          <>
            <PhoneOff className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">End call</span>
          </>
        )}
      </button>
    );
  }

  if (idle) {
    return (
      <button
        onClick={onStart}
        className={cn(
          "btn-primary",
          compact ? "px-4 py-2 text-[13px]" : "px-6 py-3 text-[15px]"
        )}
      >
        <Phone className={compact ? "h-4 w-4" : "h-5 w-5"} />
        Start conversation
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onMute}
        disabled={!isActive}
        className={cn(
          "btn",
          muted
            ? "bg-red-500/15 text-red-300 border border-red-500/25"
            : "bg-white/[0.06] text-ink-100 border border-white/[0.08]",
          compact ? "px-3 py-2" : "px-4 py-2.5"
        )}
        title={muted ? "Unmute" : "Mute"}
      >
        {muted ? (
          <MicOff className="h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
        {!compact && <span>{muted ? "Muted" : "Mic on"}</span>}
      </button>

      <button
        onClick={onEnd}
        disabled={status === "closing"}
        className={cn(
          "btn-danger",
          compact ? "px-4 py-2 text-[13px]" : "px-5 py-2.5 text-[14px]"
        )}
      >
        {isConnecting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Connecting…
          </>
        ) : (
          <>
            <PhoneOff className="h-4 w-4" />
            End call
          </>
        )}
      </button>
    </div>
  );
}

function StatusPill({
  status,
  orbState,
}: {
  status: ConnStatus;
  orbState: OrbState;
}) {
  if (status === "connecting") {
    return (
      <span className="chip bg-amber-400/15 text-amber-200">
        <Loader2 className="h-3 w-3 animate-spin" />
        Connecting
      </span>
    );
  }
  if (status === "ready") {
    const color =
      orbState === "speaking"
        ? "bg-accent-orange/15 text-orange-200"
        : orbState === "listening"
        ? "bg-accent-lime/15 text-lime-200"
        : orbState === "thinking"
        ? "bg-accent/15 text-violet-200"
        : "bg-white/5 text-ink-300";
    return (
      <span className={cn("chip", color)}>
        <Activity className="h-3 w-3" />
        Live
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="chip bg-red-500/15 text-red-300">
        <AlertCircle className="h-3 w-3" />
        Error
      </span>
    );
  }
  return (
    <span className="chip bg-white/5 text-ink-300">
      <Wifi className="h-3 w-3" />
      Idle
    </span>
  );
}

function statusLabel(status: ConnStatus, orbState: OrbState): string {
  if (status === "connecting") return "Connecting…";
  if (status === "closed") return "Call ended";
  if (status === "error") return "Error";
  if (status === "ready") {
    if (orbState === "speaking") return "Assistant speaking";
    if (orbState === "listening") return "Listening";
    if (orbState === "thinking") return "Thinking";
    return "Ready";
  }
  return "Voice agent";
}

function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const bars = 5;
  return (
    <div className="flex items-end gap-0.5 h-5 w-8">
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = (i + 1) / bars;
        const on = active && level >= threshold * 0.6;
        return (
          <div
            key={i}
            className={cn(
              "w-1 rounded-sm transition-all duration-75",
              on ? "bg-accent-lime" : "bg-white/10"
            )}
            style={{
              height: `${20 + i * 20}%`,
              opacity: active ? 1 : 0.5,
            }}
          />
        );
      })}
    </div>
  );
}

function orbLabel(state: OrbState): string {
  switch (state) {
    case "idle":
      return "Ready";
    case "connecting":
      return "Connecting";
    case "listening":
      return "Listening";
    case "thinking":
      return "Thinking";
    case "speaking":
      return "Speaking";
    case "error":
      return "Error";
  }
}

function subtitleFor(
  status: ConnStatus,
  orbState: OrbState,
  muted: boolean
): string {
  if (status === "idle" || status === "closed") {
    return "Tap Start and speak naturally — Grok handles turn-taking for you.";
  }
  if (status === "error") return "Something went wrong — hit Start to retry.";
  if (status === "connecting") return "Opening secure connection…";
  if (muted) return "Your mic is muted. Tap Mic to unmute.";
  if (orbState === "speaking") return "Grok is speaking — interrupt anytime.";
  if (orbState === "thinking") return "Thinking through your request…";
  return "I'm listening — go ahead.";
}

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
    // Fail-safe: don't wait more than 2 seconds.
    setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }, 2000);
  });
}
