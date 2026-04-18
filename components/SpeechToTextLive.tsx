"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Circle,
  Copy,
  Check,
  Trash2,
  Loader2,
  Users,
  Settings2,
  AlertCircle,
  Wifi,
  Wand2,
} from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import { STT_LANGUAGES } from "@/lib/constants";

type ConnStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "recording"
  | "closed"
  | "error";

type Word = {
  text: string;
  start: number;
  end: number;
  speaker?: number;
};

type FinalSegment = {
  id: string;
  text: string;
  words: Word[];
  speaker?: number;
};

type ServerEvent =
  | { type: "transcript.created" }
  | {
      type: "transcript.partial";
      text: string;
      words: Word[];
      is_final: boolean;
      speech_final: boolean;
      start?: number;
      duration?: number;
    }
  | {
      type: "transcript.done";
      text: string;
      words: Word[];
      duration: number;
    }
  | { type: "error"; message: string };

export default function SpeechToTextLive() {
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Fully committed utterances (after speech_final or transcript.done).
  const [commits, setCommits] = useState<FinalSegment[]>([]);
  // Chunk-finals within the current in-progress utterance. These are
  // replaced by the stitched utterance-final when it arrives.
  const [pending, setPending] = useState<FinalSegment[]>([]);
  const [partial, setPartial] = useState<string>("");
  const [level, setLevel] = useState<number>(0);
  const [elapsed, setElapsed] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);

  // Settings
  const [language, setLanguage] = useState<string>("en");
  const [formatting, setFormatting] = useState<boolean>(true);
  const [interim, setInterim] = useState<boolean>(true);
  const [diarize, setDiarize] = useState<boolean>(false);
  const [endpointing, setEndpointing] = useState<number>(500);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const statusRef = useRef<ConnStatus>("idle");

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (status !== "recording") return;
    const t = setInterval(() => {
      setElapsed((Date.now() - startTimeRef.current) / 1000);
    }, 200);
    return () => clearInterval(t);
  }, [status]);

  const cleanup = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (workletRef.current) {
      try {
        workletRef.current.port.close();
        workletRef.current.disconnect();
      } catch {}
      workletRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {}
      analyserRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "audio.done" }));
        }
      } catch {}
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    setLevel(0);
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const handleStart = useCallback(async () => {
    setError(null);
    setCommits([]);
    setPending([]);
    setPartial("");
    setElapsed(0);

    const AudioCtor: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;

    // Ask the browser for a 16 kHz AudioContext. The mic signal is
    // resampled natively (with proper anti-aliasing) to 16 kHz — which
    // is the rate we stream to xAI. If the browser refuses, fall back
    // to the default rate (we'd need JS resampling — caught below).
    let audioCtx: AudioContext;
    try {
      audioCtx = new AudioCtor({ sampleRate: 16000 });
    } catch {
      audioCtx = new AudioCtor();
    }
    audioCtxRef.current = audioCtx;

    setStatus("connecting");

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
    } catch {
      setStatus("error");
      setError(
        "Microphone permission denied. Please allow microphone access and try again."
      );
      cleanup();
      return;
    }
    streamRef.current = stream;

    try {
      await audioCtx.audioWorklet.addModule("/worklets/pcm-capture.js");
    } catch {
      setStatus("error");
      setError("Failed to load audio worklet.");
      cleanup();
      return;
    }

    const source = audioCtx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioCtx, "pcm-capture", {
      processorOptions: { chunkMs: 100 },
    });
    workletRef.current = worklet;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyserRef.current = analyser;

    source.connect(analyser);
    source.connect(worklet);

    const params = new URLSearchParams({
      sample_rate: String(Math.round(audioCtx.sampleRate)),
      encoding: "pcm",
      interim_results: interim ? "true" : "false",
      endpointing: String(endpointing),
    });
    // Providing `language` is what enables ITN / text formatting on the
    // WebSocket endpoint — when the toggle is off, we simply omit it.
    if (formatting && language) params.set("language", language);
    if (diarize) params.set("diarize", "true");

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${wsProto}//${window.location.host}/api/ws/stt?${params.toString()}`
    );
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (
        ws.readyState === WebSocket.OPEN &&
        statusRef.current === "recording"
      ) {
        ws.send(e.data);
      }
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let event: ServerEvent;
      try {
        event = JSON.parse(ev.data);
      } catch {
        return;
      }

      switch (event.type) {
        case "transcript.created":
          setStatus("recording");
          startTimeRef.current = Date.now();
          break;

        case "transcript.partial": {
          if (!event.is_final) {
            setPartial(event.text || "");
            return;
          }
          setPartial("");
          if (!event.text || !event.text.trim()) {
            if (event.speech_final) setPending([]);
            return;
          }
          const speaker =
            event.words && event.words.length > 0
              ? event.words[0].speaker
              : undefined;
          const seg: FinalSegment = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text: event.text,
            words: event.words || [],
            speaker,
          };
          if (!event.speech_final) {
            // Chunk-final: buffer until the stitched utterance-final.
            setPending((prev) => [...prev, seg]);
          } else {
            // Utterance-final: this IS the stitched version of the pending
            // chunk-finals for the current utterance. Commit it and drop
            // the per-chunk entries to avoid duplication.
            setCommits((prev) => [...prev, seg]);
            setPending([]);
          }
          break;
        }

        case "transcript.done":
          // End-of-turn. Only non-empty if the utterance-final didn't
          // already cover all audio. Commit and clear pending.
          if (event.text && event.text.trim()) {
            setCommits((prev) => [
              ...prev,
              {
                id: `${Date.now()}-done`,
                text: event.text,
                words: event.words || [],
              },
            ]);
          }
          setPending([]);
          setPartial("");
          break;

        case "error":
          setError(event.message || "Unknown error");
          break;
      }
    };

    ws.onerror = () => {
      setError("WebSocket error. Check the server logs.");
      setStatus("error");
    };

    ws.onclose = () => {
      setStatus((s) => (s === "error" || s === "idle" ? s : "closed"));
      cleanup();
    };

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      setLevel(Math.min(1, rms * 3));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, [
    cleanup,
    diarize,
    endpointing,
    formatting,
    interim,
    language,
  ]);

  const handleStop = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: "audio.done" }));
      } catch {}
    }
    cleanup();
    setStatus("closed");
  }, [cleanup]);

  const fullTranscript = useMemo(() => {
    const parts: string[] = [];
    for (const c of commits) parts.push(c.text);
    for (const p of pending) parts.push(p.text);
    return parts.join(" ").trim();
  }, [commits, pending]);

  const handleCopy = async () => {
    if (!fullTranscript) return;
    try {
      await navigator.clipboard.writeText(fullTranscript);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const handleClear = () => {
    setCommits([]);
    setPending([]);
    setPartial("");
    setError(null);
  };

  const isRecording = status === "recording";
  const isConnecting = status === "connecting";
  const locked = isRecording || isConnecting;

  return (
    <div className="grid lg:grid-cols-[300px_1fr] gap-4 md:gap-5 h-full min-h-0">
      <aside className="card p-4 flex flex-col lg:h-full">
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="h-4 w-4 text-ink-300" />
          <h2 className="text-sm font-semibold">Settings</h2>
        </div>

        <CompactRow
          label="Text formatting"
          icon={<Wand2 className="h-3.5 w-3.5" />}
          checked={formatting}
          onChange={setFormatting}
          disabled={locked}
        />

        <label className="block mb-3">
          <span className="block text-[11px] uppercase tracking-wider text-ink-400 mb-1">
            Language
          </span>
          <select
            className="select py-2 text-sm"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={locked || !formatting}
          >
            {STT_LANGUAGES.filter((l) => l.code).map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] uppercase tracking-wider text-ink-400">
              Endpointing
            </span>
            <span className="text-[11px] text-ink-200 font-mono">
              {endpointing} ms
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={2000}
            step={50}
            value={endpointing}
            onChange={(e) => setEndpointing(Number(e.target.value))}
            disabled={locked}
            className="w-full accent-accent-lime"
          />
        </label>

        <CompactRow
          label="Interim results"
          checked={interim}
          onChange={setInterim}
          disabled={locked}
        />
        <CompactRow
          label="Speaker diarization"
          icon={<Users className="h-3.5 w-3.5" />}
          checked={diarize}
          onChange={setDiarize}
          disabled={locked}
        />

        <div className="mt-auto pt-3 border-t border-white/5">
          {!locked ? (
            <button className="btn-primary w-full" onClick={handleStart}>
              <Mic className="h-4 w-4" />
              Start recording
            </button>
          ) : (
            <button className="btn-danger w-full" onClick={handleStop}>
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Connecting…
                </>
              ) : (
                <>
                  <MicOff className="h-4 w-4" /> Stop recording
                </>
              )}
            </button>
          )}

          <div className="mt-2 flex items-center justify-between text-[11px] text-ink-400">
            <StatusPill status={status} />
            <span className="font-mono">{formatDuration(elapsed)}</span>
          </div>
        </div>
      </aside>

      <div className="card p-0 overflow-hidden flex flex-col min-h-0 lg:h-full">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <LevelMeter level={level} active={isRecording} />
            <span className="text-sm font-medium">
              {isRecording ? "Listening…" : "Transcript"}
            </span>
            {formatting && (
              <span className="chip bg-accent-lime/10 text-lime-200 border border-accent-lime/20">
                <Wand2 className="h-3 w-3" /> ITN
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              className="btn-ghost text-xs"
              onClick={handleCopy}
              disabled={!fullTranscript}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> Copy
                </>
              )}
            </button>
            <button
              className="btn-ghost text-xs"
              onClick={handleClear}
              disabled={!fullTranscript && !partial}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-200">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4 md:p-5">
          {commits.length === 0 &&
          pending.length === 0 &&
          !partial &&
          !isRecording ? (
            <EmptyState />
          ) : (
            <div className="space-y-3 leading-relaxed">
              {diarize ? (
                <DiarizedView
                  commits={commits}
                  pending={pending}
                  partial={partial}
                />
              ) : (
                <PlainView
                  commits={commits}
                  pending={pending}
                  partial={partial}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlainView({
  commits,
  pending,
  partial,
}: {
  commits: FinalSegment[];
  pending: FinalSegment[];
  partial: string;
}) {
  return (
    <p className="text-[15px] md:text-base text-ink-50 whitespace-pre-wrap">
      {commits.map((f) => f.text).join(" ")}
      {commits.length > 0 && (pending.length > 0 || partial) ? " " : ""}
      {pending.length > 0 && (
        <span className="text-ink-100/90">
          {pending.map((f) => f.text).join(" ")}
        </span>
      )}
      {partial && (
        <>
          {pending.length > 0 ? " " : ""}
          <span className="text-ink-300 italic">{partial}</span>
        </>
      )}
    </p>
  );
}

function DiarizedView({
  commits,
  pending,
  partial,
}: {
  commits: FinalSegment[];
  pending: FinalSegment[];
  partial: string;
}) {
  const groups: { speaker?: number; texts: string[]; kind: "commit" | "pending" }[] =
    [];
  const push = (seg: FinalSegment, kind: "commit" | "pending") => {
    const last = groups[groups.length - 1];
    if (last && last.speaker === seg.speaker && last.kind === kind) {
      last.texts.push(seg.text);
    } else {
      groups.push({ speaker: seg.speaker, texts: [seg.text], kind });
    }
  };
  for (const c of commits) push(c, "commit");
  for (const p of pending) push(p, "pending");
  return (
    <div className="space-y-3">
      {groups.map((g, i) => (
        <div
          key={i}
          className={cn(
            "flex gap-3",
            g.kind === "pending" && "opacity-80"
          )}
        >
          <SpeakerBadge speaker={g.speaker} />
          <div className="flex-1 text-[15px] text-ink-50">
            {g.texts.join(" ")}
          </div>
        </div>
      ))}
      {partial && (
        <div className="flex gap-3 opacity-70">
          <div className="chip bg-white/5 text-ink-300">···</div>
          <div className="flex-1 text-[15px] italic text-ink-300">
            {partial}
          </div>
        </div>
      )}
    </div>
  );
}

function SpeakerBadge({ speaker }: { speaker?: number }) {
  const label = speaker === undefined ? "?" : speaker + 1;
  const palette = [
    "bg-accent/20 text-violet-200 border-accent/30",
    "bg-accent-lime/20 text-lime-200 border-accent-lime/30",
    "bg-accent-orange/20 text-orange-200 border-accent-orange/30",
    "bg-sky-400/20 text-sky-200 border-sky-400/30",
    "bg-pink-400/20 text-pink-200 border-pink-400/30",
  ];
  const cls =
    speaker === undefined
      ? "bg-white/10 text-ink-200 border-white/10"
      : palette[speaker % palette.length];
  return (
    <div
      className={cn(
        "flex-shrink-0 h-7 w-16 rounded-full border text-[11px] font-medium flex items-center justify-center",
        cls
      )}
    >
      <Users className="h-3 w-3 mr-1" /> {label}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-6">
      <div className="relative h-16 w-16 rounded-full glass flex items-center justify-center mb-4">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-accent-lime/10 to-accent/10" />
        <Mic className="relative h-7 w-7 text-ink-300" />
      </div>
      <h3 className="text-sm font-medium text-ink-100">Ready to transcribe</h3>
      <p className="mt-1.5 max-w-xs text-[13px] text-ink-400">
        Hit <span className="kbd">Start recording</span> to stream audio from
        your microphone.
      </p>
    </div>
  );
}

function CompactRow({
  label,
  icon,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cn(
        "w-full flex items-center justify-between py-2 text-[13px] text-ink-100 hover:text-ink-50 transition-colors",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <span className="flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors",
          checked ? "bg-accent-lime" : "bg-white/10"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-ink-950 transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  );
}

function Toggle({
  label,
  description,
  icon,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "w-full text-left mb-2.5 px-3 py-2.5 rounded-xl border transition-colors",
        "border-white/5 hover:bg-white/[0.02]",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium flex items-center gap-1.5">
            {icon}
            {label}
          </div>
          {description && (
            <div className="text-[11px] text-ink-400 mt-0.5 leading-snug">
              {description}
            </div>
          )}
        </div>
        <span
          className={cn(
            "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors",
            checked ? "bg-accent-lime" : "bg-white/10"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-ink-950 transition-transform",
              checked ? "translate-x-[18px]" : "translate-x-0.5"
            )}
          />
        </span>
      </div>
    </button>
  );
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
    ready: {
      label: "Ready",
      cls: "bg-accent-lime/15 text-lime-200",
      icon: <Wifi className="h-3 w-3" />,
    },
    recording: {
      label: "Recording",
      cls: "bg-red-500/15 text-red-300",
      icon: (
        <span className="rec-dot">
          <Circle className="h-2.5 w-2.5 fill-current" />
        </span>
      ),
    },
    closed: {
      label: "Closed",
      cls: "bg-white/5 text-ink-300",
      icon: <Circle className="h-2.5 w-2.5 fill-current" />,
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
