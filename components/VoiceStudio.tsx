"use client";

import { useEffect, useState } from "react";
import { Mic, AudioWaveform } from "lucide-react";
import { cn } from "@/lib/utils";
import SpeechToText from "./SpeechToText";
import TextToSpeech from "./TextToSpeech";

type Mode = "stt" | "tts";

export default function VoiceStudio() {
  const [mode, setMode] = useState<Mode>("stt");

  // Preserve the selected mode in the URL hash for shareability.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace("#", "");
    if (hash.startsWith("tts")) setMode("tts");
    else if (hash.startsWith("stt")) setMode("stt");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    // Only rewrite the hash if we're not inside a sub-route (e.g. #stt/upload)
    if (
      !window.location.hash.startsWith("#stt/") &&
      !window.location.hash.startsWith("#tts/")
    ) {
      url.hash = mode;
      window.history.replaceState(null, "", url.toString());
    }
  }, [mode]);

  return (
    <main className="min-h-screen mx-auto max-w-6xl px-4 md:px-6 py-4 md:py-5 flex flex-col">
      <Header mode={mode} onModeChange={setMode} />
      <section className="mt-4 md:mt-5 flex-1 min-h-0">
        {mode === "stt" ? <SpeechToText /> : <TextToSpeech />}
      </section>
      <Footer />
    </main>
  );
}

function Header({
  mode,
  onModeChange,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
}) {
  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="relative h-10 w-10 rounded-xl glass-strong flex items-center justify-center">
          <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-accent-lime/20 to-accent/20" />
          <AudioWaveform className="relative h-5 w-5 text-accent-lime" />
        </div>
        <div>
          <h1 className="text-lg md:text-xl font-semibold tracking-tight">
            Grok Voice Studio
          </h1>
          <p className="text-[11px] md:text-xs text-ink-300">
            Realtime STT & TTS over WebSocket · powered by{" "}
            <span className="text-ink-100 font-medium">xAI Grok</span>
          </p>
        </div>
      </div>

      <ModeToggle mode={mode} onChange={onModeChange} />
    </header>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Mode"
      className="relative glass rounded-xl p-1 flex items-center gap-1"
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-1 bottom-1 rounded-lg transition-transform duration-300 ease-out",
          "bg-accent-lime shadow-[0_6px_20px_-6px_rgba(201,242,108,0.6)]",
          "w-[calc(50%-0.125rem)]",
          mode === "stt"
            ? "translate-x-0"
            : "translate-x-[calc(100%+0.25rem)]"
        )}
      />
      <ModeTab
        active={mode === "stt"}
        onClick={() => onChange("stt")}
        icon={<Mic className="h-3.5 w-3.5" />}
        label="Speech → Text"
      />
      <ModeTab
        active={mode === "tts"}
        onClick={() => onChange("tts")}
        icon={<AudioWaveform className="h-3.5 w-3.5" />}
        label="Text → Speech"
      />
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "relative z-10 flex items-center justify-center gap-1.5 px-3 md:px-4 py-1.5 rounded-lg",
        "text-xs md:text-[13px] font-medium transition-colors whitespace-nowrap",
        active ? "text-ink-950" : "text-ink-200 hover:text-ink-50"
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{label.split(" ").pop()}</span>
    </button>
  );
}

function Footer() {
  return (
    <footer className="mt-3 pt-2 text-center text-[11px] text-ink-400">
      <p>
        Built by{" "}
        <a
          href="https://x.com/ai_for_success"
          target="_blank"
          rel="noreferrer"
          className="text-ink-100 hover:text-accent-lime transition-colors font-medium inline-flex items-center gap-1"
        >
          <span>Ashutosh Shrivastava</span>
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-3 w-3 fill-current"
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
      </p>
    </footer>
  );
}
