"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Play,
  Square,
  Loader2,
  AlertCircle,
  Download,
  Sparkles,
  Volume2,
  Wand2,
  Wifi,
  Circle,
  Pause,
} from "lucide-react";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import {
  SPEECH_TAG_PRESETS,
  TTS_LANGUAGES,
  VOICES,
  type VoiceId,
} from "@/lib/constants";

type ConnStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "done"
  | "error";

const SAMPLE_TEXTS = [
  "Have you heard the new Grok Voice? [pause] <whisper>Let me tell you a secret.</whisper> I am the smartest and best AI. [laugh] Give it a go — ask me anything.",
  "Welcome to Grok Voice Studio. This realtime text-to-speech engine streams audio over WebSocket with <emphasis>expressive</emphasis> inline tags and ultra-low latency.",
  "Thank you for calling Best Bank. Your mortgage rate lock is set at three point seven five percent and is valid until March tenth.",
];

// MP3 is what the xAI docs recommend for browser playback — it plays
// through a standard <audio> element. We accumulate the streamed chunks,
// then build a single Blob and start playing as soon as `audio.done`.
const TTS_CODEC = "mp3";
const TTS_SAMPLE_RATE = 24000;
const TTS_BIT_RATE = 128000;

export default function TextToSpeech() {
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<string>(SAMPLE_TEXTS[0]);
  const [voice, setVoice] = useState<VoiceId>("eve");
  const [language, setLanguage] = useState<string>("en");
  const [progress, setProgress] = useState<{ chunks: number; bytes: number }>({
    chunks: 0,
    bytes: 0,
  });
  const [traceId, setTraceId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playTime, setPlayTime] = useState<{ cur: number; total: number }>({
    cur: 0,
    total: 0,
  });
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  const wsRef = useRef<WebSocket | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const mp3BytesRef = useRef<Uint8Array[]>([]);
  const statusRef = useRef<ConnStatus>("idle");
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Ticking elapsed time while streaming
  useEffect(() => {
    if (status !== "streaming" && status !== "connecting") return;
    const t = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 100);
    return () => clearInterval(t);
  }, [status]);

  // Clean up blob URL when it changes or unmounts.
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const cleanupConnection = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupConnection();
      if (audioElRef.current) {
        try {
          audioElRef.current.pause();
        } catch {}
      }
    };
  }, [cleanupConnection]);

  const handleGenerate = useCallback(async () => {
    if (!text.trim()) return;
    setError(null);
    setTraceId(null);
    setProgress({ chunks: 0, bytes: 0 });
    setPlayTime({ cur: 0, total: 0 });
    mp3BytesRef.current = [];
    startedAtRef.current = Date.now();
    setElapsedMs(0);

    // Revoke previous blob URL if any.
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
      } catch {}
    }

    setStatus("connecting");

    const params = new URLSearchParams({
      voice,
      language,
      codec: TTS_CODEC,
      sample_rate: String(TTS_SAMPLE_RATE),
      bit_rate: String(TTS_BIT_RATE),
    });

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${wsProto}//${window.location.host}/api/ws/tts?${params.toString()}`
    );
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("streaming");
      try {
        ws.send(JSON.stringify({ type: "text.delta", delta: text }));
        ws.send(JSON.stringify({ type: "text.done" }));
      } catch {
        setError("Failed to send text.");
        setStatus("error");
      }
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let event: any;
      try {
        event = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (event.type === "audio.delta") {
        const bytes = base64ToBytes(event.delta);
        if (!bytes || bytes.byteLength === 0) return;
        mp3BytesRef.current.push(bytes);
        setProgress((p) => ({
          chunks: p.chunks + 1,
          bytes: p.bytes + bytes.byteLength,
        }));
      } else if (event.type === "audio.done") {
        if (event.trace_id) setTraceId(event.trace_id);
        // Build the MP3 blob and start playback.
        const blob = new Blob(mp3BytesRef.current as BlobPart[], {
          type: "audio/mpeg",
        });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setStatus("done");
        // Autoplay (user gesture started this flow, so allowed).
        requestAnimationFrame(() => {
          const el = audioElRef.current;
          if (el) {
            el.src = url;
            el.play().catch((err) => {
              setError(
                `Autoplay was blocked: ${err?.message || err}. Press Play below.`
              );
            });
          }
        });
        try {
          ws.close();
        } catch {}
      } else if (event.type === "error") {
        setError(event.message || "Unknown error");
        setStatus("error");
      }
    };

    ws.onerror = () => {
      setError("WebSocket error. Check the server logs.");
      setStatus("error");
    };

    ws.onclose = () => {
      if (statusRef.current === "streaming") setStatus("done");
    };
  }, [audioUrl, language, text, voice]);

  const handleStop = useCallback(() => {
    cleanupConnection();
    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
      } catch {}
    }
    setStatus("idle");
  }, [cleanupConnection]);

  const handlePlayPause = useCallback(async () => {
    const el = audioElRef.current;
    if (!el || !audioUrl) return;
    if (el.paused) {
      try {
        await el.play();
      } catch (err: any) {
        setError(err?.message || String(err));
      }
    } else {
      el.pause();
    }
  }, [audioUrl]);

  const handleDownload = useCallback(() => {
    if (mp3BytesRef.current.length === 0) return;
    const blob = new Blob(mp3BytesRef.current as BlobPart[], {
      type: "audio/mpeg",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grok-tts-${voice}-${Date.now()}.mp3`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [voice]);

  const insertTag = (tag: (typeof SPEECH_TAG_PRESETS)[number]) => {
    const el = textAreaRef.current;
    if (!el) {
      setText((t) => t + " " + tag.insert);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    let insert: string = tag.insert;
    if (tag.kind === "wrap") {
      const selected = el.value.slice(start, end);
      insert = (tag.insert as string).replace("TEXT", selected || "text");
    }
    const next = el.value.slice(0, start) + insert + el.value.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + insert.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const charCount = text.length;
  const isBusy = status === "connecting" || status === "streaming";
  const canGenerate = !isBusy && text.trim().length > 0;

  const streamingProgress = useMemo(() => {
    // Give a visual clue even before the first chunk arrives: lerp from 0 to
    // ~25 % over the first 2 s of connection/streaming.
    if (progress.chunks === 0) {
      if (!isBusy) return 0;
      return Math.min(0.25, elapsedMs / 8000);
    }
    // After first chunk, proportionally grow toward ~90 %.
    const base = 0.25;
    const grown = Math.min(0.65, progress.chunks * 0.05);
    return base + grown;
  }, [progress.chunks, isBusy, elapsedMs]);

  return (
    <div className="grid lg:grid-cols-[1fr_300px] gap-4 md:gap-5 lg:min-h-full">
      <div className="card p-0 flex flex-col lg:min-h-full">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-ink-300" />
            <span className="text-sm font-medium">Compose</span>
            <span className="chip bg-white/5 text-ink-300">
              {charCount.toLocaleString()} / 15,000
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost text-xs"
              onClick={() =>
                setText(
                  SAMPLE_TEXTS[Math.floor(Math.random() * SAMPLE_TEXTS.length)]
                )
              }
              disabled={isBusy}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Sample
            </button>
          </div>
        </div>

        <div className="p-5 flex flex-col flex-1">
          <textarea
            ref={textAreaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type or paste text here. Use speech tags like [pause], [laugh], or <whisper>…</whisper> for expressive delivery."
            maxLength={15000}
            className={cn(
              "w-full flex-1 min-h-[160px] resize-none rounded-xl",
              "bg-white/[0.03] border border-white/[0.06] p-4",
              "text-[15px] leading-relaxed placeholder:text-ink-400",
              "focus:outline-none focus:border-accent/30 focus:bg-white/[0.05]",
              "scrollbar-thin font-mono"
            )}
            disabled={isBusy}
          />

          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">
              Speech tags
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SPEECH_TAG_PRESETS.map((tag) => (
                <button
                  key={tag.label}
                  onClick={() => insertTag(tag)}
                  disabled={isBusy}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-mono",
                    "bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]",
                    "text-ink-200 hover:text-ink-50 transition-colors",
                    "disabled:opacity-40 disabled:cursor-not-allowed"
                  )}
                >
                  {tag.label}
                </button>
              ))}
            </div>
          </div>

          {(audioUrl || isBusy) && (
            <PlayerCard
              audioUrl={audioUrl}
              audioElRef={audioElRef}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              playTime={playTime}
              setPlayTime={setPlayTime}
              status={status}
              progress01={streamingProgress}
              chunks={progress.chunks}
              bytes={progress.bytes}
              elapsedMs={elapsedMs}
              onPlayPause={handlePlayPause}
              onDownload={handleDownload}
            />
          )}
        </div>

        {error && (
          <div className="mx-5 mb-5 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-200">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="px-5 py-4 border-t border-white/5 flex items-center justify-between gap-3 bg-white/[0.02]">
          <div className="flex items-center gap-3 text-xs text-ink-300 min-w-0">
            <StatusPill status={status} />
            {(isBusy || progress.chunks > 0) && (
              <span className="font-mono truncate">
                {progress.chunks} chunks · {formatBytes(progress.bytes)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isBusy ? (
              <button className="btn-danger" onClick={handleStop}>
                <Square className="h-4 w-4" />
                Stop
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={handleGenerate}
                disabled={!canGenerate}
              >
                <Play className="h-4 w-4" />
                Generate & play
              </button>
            )}
          </div>
        </div>
      </div>

      <aside className="card p-4 lg:h-full">
        <div className="flex items-center gap-2 mb-4">
          <Volume2 className="h-4 w-4 text-ink-300" />
          <h2 className="text-sm font-semibold">Settings</h2>
        </div>

        <label className="block mb-4">
          <span className="block text-xs text-ink-300 mb-1.5">Voice</span>
          <select
            className="select"
            value={voice}
            onChange={(e) => setVoice(e.target.value as VoiceId)}
            disabled={isBusy}
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.tone}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-ink-400 leading-snug">
            {VOICES.find((v) => v.id === voice)?.description}
          </p>
        </label>

        <label className="block mb-4">
          <span className="block text-xs text-ink-300 mb-1.5">Language</span>
          <select
            className="select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={isBusy}
          >
            {TTS_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        {traceId && (
          <div className="mt-5 pt-5 border-t border-white/5">
            <div className="text-[11px] text-ink-400">Trace ID</div>
            <code className="block mt-1 text-[11px] font-mono text-ink-200 break-all">
              {traceId}
            </code>
          </div>
        )}

        <div className="mt-5 pt-5 border-t border-white/5 text-[11px] text-ink-400 leading-relaxed">
          Audio streams as{" "}
          <span className="text-ink-200 font-mono">MP3 · 24 kHz · 128 kbps</span>{" "}
          over WebSocket. Playback starts the moment{" "}
          <code className="text-ink-200">audio.done</code> arrives — typically
          1–3&nbsp;s after you hit Generate.
        </div>
      </aside>
    </div>
  );
}

function PlayerCard({
  audioUrl,
  audioElRef,
  isPlaying,
  setIsPlaying,
  playTime,
  setPlayTime,
  status,
  progress01,
  chunks,
  bytes,
  elapsedMs,
  onPlayPause,
  onDownload,
}: {
  audioUrl: string | null;
  audioElRef: React.MutableRefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  setIsPlaying: (b: boolean) => void;
  playTime: { cur: number; total: number };
  setPlayTime: (t: { cur: number; total: number }) => void;
  status: ConnStatus;
  progress01: number;
  chunks: number;
  bytes: number;
  elapsedMs: number;
  onPlayPause: () => void;
  onDownload: () => void;
}) {
  const isBusy = status === "connecting" || status === "streaming";

  return (
    <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onPlayPause}
          disabled={!audioUrl || isBusy}
          className={cn(
            "relative h-12 w-12 rounded-full flex items-center justify-center",
            "bg-accent-lime text-ink-950 transition-all",
            "hover:bg-accent-lime/90 disabled:opacity-40 disabled:cursor-not-allowed",
            "shadow-[0_6px_20px_-6px_rgba(201,242,108,0.6)]"
          )}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isBusy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5 ml-0.5" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 text-xs text-ink-300 mb-2">
            <span className="truncate">
              {isBusy ? (
                <>
                  <span className="text-ink-100">
                    {status === "connecting" ? "Connecting…" : "Streaming audio"}
                  </span>
                  <span className="ml-2 font-mono text-ink-400">
                    {chunks} chunks · {formatBytes(bytes)} ·{" "}
                    {(elapsedMs / 1000).toFixed(1)}s
                  </span>
                </>
              ) : audioUrl ? (
                <>
                  <span className="font-mono text-ink-100">
                    {formatDuration(playTime.cur)} /{" "}
                    {formatDuration(playTime.total)}
                  </span>
                  <span className="ml-2 text-ink-400">
                    · MP3 · {formatBytes(bytes)}
                  </span>
                </>
              ) : (
                <span>Preparing audio…</span>
              )}
            </span>
            {audioUrl && !isBusy && (
              <button className="btn-ghost text-xs" onClick={onDownload}>
                <Download className="h-3.5 w-3.5" /> MP3
              </button>
            )}
          </div>

          {/* Progress bar */}
          <div className="relative h-1.5 rounded-full overflow-hidden bg-white/[0.06]">
            <div
              className={cn(
                "absolute inset-y-0 left-0 transition-all duration-200",
                isBusy
                  ? "bg-gradient-to-r from-accent to-accent-lime bg-[length:200%_100%] animate-shimmer"
                  : "bg-accent-lime"
              )}
              style={{
                width: isBusy
                  ? `${Math.min(100, progress01 * 100)}%`
                  : audioUrl && playTime.total > 0
                  ? `${Math.min(100, (playTime.cur / playTime.total) * 100)}%`
                  : "0%",
              }}
            />
          </div>
        </div>
      </div>

      <audio
        ref={audioElRef}
        preload="auto"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setPlayTime({
            cur: el.currentTime,
            total: Number.isFinite(el.duration) ? el.duration : 0,
          });
        }}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setPlayTime({
            cur: 0,
            total: Number.isFinite(el.duration) ? el.duration : 0,
          });
        }}
        className="hidden"
      />
    </div>
  );
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64);
    const len = binary.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function StatusPill({ status }: { status: ConnStatus }) {
  const map: Record<
    ConnStatus,
    { label: string; cls: string; icon: JSX.Element }
  > = {
    idle: {
      label: "Idle",
      cls: "bg-white/5 text-ink-300",
      icon: <Circle className="h-2.5 w-2.5 fill-current" />,
    },
    connecting: {
      label: "Connecting",
      cls: "bg-amber-400/15 text-amber-200",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    streaming: {
      label: "Streaming",
      cls: "bg-accent/15 text-violet-200",
      icon: (
        <span className="rec-dot">
          <Circle className="h-2.5 w-2.5 fill-current" />
        </span>
      ),
    },
    done: {
      label: "Ready",
      cls: "bg-accent-lime/15 text-lime-200",
      icon: <Wifi className="h-3 w-3" />,
    },
    error: {
      label: "Error",
      cls: "bg-red-500/15 text-red-300",
      icon: <AlertCircle className="h-3 w-3" />,
    },
  };
  const s = map[status];
  return (
    <span className={cn("chip", s.cls)}>
      {s.icon}
      {s.label}
    </span>
  );
}
