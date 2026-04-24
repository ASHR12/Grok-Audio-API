"use client";

import { useEffect, useRef } from "react";
import { Sparkles, User, Wrench, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToolCallEntry = {
  id: string;
  tool: string;
  label: string; // e.g. "web_search" or "get_weather"
  args?: string;
  output?: string;
  status: "calling" | "done" | "error";
};

export type TranscriptMessage =
  | {
      kind: "user";
      id: string;
      text: string;
      final: boolean;
    }
  | {
      kind: "assistant";
      id: string;
      text: string;
      final: boolean;
    }
  | {
      kind: "tool";
      id: string;
      entry: ToolCallEntry;
    }
  | {
      kind: "system";
      id: string;
      text: string;
    };

export default function TranscriptView({
  messages,
  isThinking,
}: {
  messages: TranscriptMessage[];
  isThinking?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the bottom — but ONLY within the transcript's own
  // scrollable ancestor. Using scrollIntoView() would scroll the window
  // if the container isn't the nearest scroll parent; we avoid that by
  // directly walking up to find the overflow-y-auto ancestor and nudging
  // its scrollTop.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let scrollEl: HTMLElement | null = el.parentElement;
    while (scrollEl) {
      const style = getComputedStyle(scrollEl);
      if (
        style.overflowY === "auto" ||
        style.overflowY === "scroll"
      ) {
        break;
      }
      scrollEl = scrollEl.parentElement;
    }
    if (!scrollEl) return;
    const near =
      scrollEl.scrollHeight -
        scrollEl.scrollTop -
        scrollEl.clientHeight <
      120;
    // If the user has scrolled up deliberately, don't yank them back.
    if (!near && messages.length > 1) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [messages, isThinking]);

  if (messages.length === 0 && !isThinking) {
    return <EmptyState />;
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      {messages.map((m) => {
        if (m.kind === "user") return <UserBubble key={m.id} msg={m} />;
        if (m.kind === "assistant") return <AssistantBubble key={m.id} msg={m} />;
        if (m.kind === "tool") return <ToolChip key={m.id} entry={m.entry} />;
        return <SystemLine key={m.id} text={m.text} />;
      })}
      {isThinking && <ThinkingBubble />}
    </div>
  );
}

function UserBubble({
  msg,
}: {
  msg: Extract<TranscriptMessage, { kind: "user" }>;
}) {
  return (
    <div className="flex justify-end bubble-in">
      <div className="flex items-start gap-2 max-w-[85%] md:max-w-[75%]">
        <div
          className={cn(
            "rounded-2xl rounded-tr-sm px-3.5 py-2.5",
            "bg-accent-lime/12 border border-accent-lime/25",
            "text-[14px] leading-relaxed text-ink-50",
            !msg.final && "italic opacity-80 border-dashed"
          )}
        >
          {msg.text || <span className="text-ink-400">…</span>}
        </div>
        <div className="mt-0.5 h-7 w-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
          <User className="h-3.5 w-3.5 text-ink-200" />
        </div>
      </div>
    </div>
  );
}

function AssistantBubble({
  msg,
}: {
  msg: Extract<TranscriptMessage, { kind: "assistant" }>;
}) {
  return (
    <div className="flex justify-start bubble-in">
      <div className="flex items-start gap-2 max-w-[85%] md:max-w-[75%]">
        <div className="mt-0.5 h-7 w-7 rounded-full bg-gradient-to-br from-accent/30 to-accent-lime/30 border border-accent/40 flex items-center justify-center flex-shrink-0">
          <Sparkles className="h-3.5 w-3.5 text-ink-50" />
        </div>
        <div
          className={cn(
            "rounded-2xl rounded-tl-sm px-3.5 py-2.5",
            "bg-white/[0.05] border border-white/[0.08]",
            "text-[14px] leading-relaxed text-ink-50",
            !msg.final && "opacity-90"
          )}
        >
          {msg.text || <StreamingDots />}
          {!msg.final && msg.text && <span className="streaming-caret ml-0.5" />}
        </div>
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex justify-start bubble-in">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 h-7 w-7 rounded-full bg-gradient-to-br from-accent/30 to-accent-lime/30 border border-accent/40 flex items-center justify-center flex-shrink-0">
          <Sparkles className="h-3.5 w-3.5 text-ink-50" />
        </div>
        <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-white/[0.05] border border-white/[0.08]">
          <StreamingDots />
        </div>
      </div>
    </div>
  );
}

function StreamingDots() {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <span className="typing-dot typing-dot-1 inline-block h-1.5 w-1.5 rounded-full bg-ink-300" />
      <span className="typing-dot typing-dot-2 inline-block h-1.5 w-1.5 rounded-full bg-ink-300" />
      <span className="typing-dot typing-dot-3 inline-block h-1.5 w-1.5 rounded-full bg-ink-300" />
    </span>
  );
}

function ToolChip({ entry }: { entry: ToolCallEntry }) {
  const color =
    entry.status === "error"
      ? "border-red-500/25 bg-red-500/10 text-red-200"
      : entry.status === "calling"
      ? "border-amber-400/25 bg-amber-400/10 text-amber-100"
      : "border-accent/25 bg-accent/10 text-violet-100";
  const summary = summariseToolArgs(entry);
  const toolLabel = prettyToolName(entry.tool);
  return (
    <div className="flex justify-center bubble-in">
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-full border pl-2.5 pr-3 py-1",
          "text-[11.5px]",
          color
        )}
      >
        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-white/[0.06]">
          <Wrench className="h-3 w-3" />
        </span>
        <span className="font-semibold text-ink-100">{toolLabel}</span>
        {summary && (
          <>
            <span className="text-ink-500">·</span>
            <span className="text-ink-300 font-normal truncate max-w-[260px] md:max-w-[380px]">
              {summary}
            </span>
          </>
        )}
        {entry.status === "calling" && (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-200/80 ml-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" />
            running
          </span>
        )}
      </div>
    </div>
  );
}

function prettyToolName(tool: string): string {
  switch (tool) {
    case "web_search":
      return "Web search";
    case "x_search":
      return "X search";
    case "file_search":
      return "Document search";
    case "get_current_time":
      return "Clock";
    case "generate_random_number":
      return "Random number";
    default:
      return tool.replace(/_/g, " ");
  }
}

function summariseToolArgs(entry: ToolCallEntry): string | null {
  if (!entry.args) return null;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(entry.args);
  } catch {
    return entry.args.length > 80 ? entry.args.slice(0, 80) + "…" : entry.args;
  }
  if (entry.tool === "web_search" || entry.tool === "x_search") {
    const q = (args.query || args.q) as string | undefined;
    return q ? `“${q}”` : null;
  }
  if (entry.tool === "generate_random_number") {
    return `${args.min ?? "?"} – ${args.max ?? "?"}`;
  }
  if (entry.tool === "get_current_time") {
    return "now";
  }
  // Generic fallback: show first two key/value pairs.
  const parts = Object.entries(args)
    .slice(0, 2)
    .map(
      ([k, v]) =>
        `${k}: ${
          typeof v === "string" ? v : JSON.stringify(v)
        }`
    );
  const joined = parts.join(", ");
  return joined.length > 80 ? joined.slice(0, 80) + "…" : joined;
}

function SystemLine({ text }: { text: string }) {
  return (
    <div className="flex justify-center bubble-in">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-ink-400">
        <CircleDot className="h-3 w-3" />
        {text}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-6">
      <div className="relative h-16 w-16 rounded-full glass flex items-center justify-center mb-4">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-accent/20 to-accent-lime/20" />
        <Sparkles className="relative h-7 w-7 text-ink-200" />
      </div>
      <h3 className="text-sm font-medium text-ink-100">Ready to talk</h3>
      <p className="mt-1.5 max-w-xs text-[13px] text-ink-400 leading-relaxed">
        Hit <span className="kbd">Start</span> and say anything.
        <br />
        The conversation appears here.
      </p>
    </div>
  );
}
