"use client";

import { cn } from "@/lib/utils";
import {
  Settings2,
  Cpu,
  Mic2,
  MessageSquare,
  Wand2,
  Globe,
  Search as SearchIcon,
  Wrench,
} from "lucide-react";
import {
  AGENT_MODELS,
  AGENT_INSTRUCTION_PRESETS,
  AGENT_VAD_DEFAULTS,
  VOICES,
  type AgentModelId,
  type VoiceId,
} from "@/lib/constants";

export type AgentSettingsState = {
  model: AgentModelId;
  voice: VoiceId;
  instructions: string;
  vad: {
    threshold: number;
    silence_duration_ms: number;
    prefix_padding_ms: number;
  };
  tools: {
    web_search: boolean;
    x_search: boolean;
    x_handles: string;
    get_current_time: boolean;
    generate_random_number: boolean;
  };
};

export const DEFAULT_AGENT_SETTINGS: AgentSettingsState = {
  model: "grok-voice-think-fast-1.0",
  voice: "eve",
  instructions: AGENT_INSTRUCTION_PRESETS[0].text,
  vad: { ...AGENT_VAD_DEFAULTS },
  tools: {
    web_search: true,
    x_search: false,
    x_handles: "",
    get_current_time: true,
    generate_random_number: false,
  },
};

export default function AgentSettings({
  value,
  onChange,
  locked,
}: {
  value: AgentSettingsState;
  onChange: (v: AgentSettingsState) => void;
  locked: boolean;
}) {
  const update = <K extends keyof AgentSettingsState>(
    key: K,
    patch: Partial<AgentSettingsState[K]>
  ) => {
    onChange({
      ...value,
      [key]:
        typeof value[key] === "object" && value[key] !== null
          ? { ...(value[key] as object), ...(patch as object) }
          : (patch as AgentSettingsState[K]),
    });
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-thin">
      <div className="flex items-center gap-2 mb-3">
        <Settings2 className="h-4 w-4 text-ink-300" />
        <h2 className="text-sm font-semibold">Settings</h2>
      </div>

      <Section icon={<Cpu className="h-3.5 w-3.5" />} title="Model">
        <select
          className="select py-2 text-sm"
          value={value.model}
          onChange={(e) =>
            onChange({ ...value, model: e.target.value as AgentModelId })
          }
          disabled={locked}
        >
          {AGENT_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.tag === "new" ? " — new" : " — legacy"}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] text-ink-400 leading-snug">
          {AGENT_MODELS.find((m) => m.id === value.model)?.description}
        </p>
      </Section>

      <Section icon={<Mic2 className="h-3.5 w-3.5" />} title="Voice">
        <select
          className="select py-2 text-sm"
          value={value.voice}
          onChange={(e) =>
            onChange({ ...value, voice: e.target.value as VoiceId })
          }
          disabled={locked}
        >
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} · {v.tone}
            </option>
          ))}
        </select>
      </Section>

      <Section
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        title="Instructions"
      >
        <div className="flex flex-wrap gap-1 mb-2">
          {AGENT_INSTRUCTION_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => onChange({ ...value, instructions: p.text })}
              disabled={locked}
              className={cn(
                "px-2 py-1 rounded-md text-[11px]",
                "bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]",
                "text-ink-200 hover:text-ink-50 transition-colors",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                value.instructions === p.text &&
                  "bg-accent-lime/10 border-accent-lime/25 text-lime-100"
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
        <textarea
          value={value.instructions}
          onChange={(e) =>
            onChange({ ...value, instructions: e.target.value })
          }
          disabled={locked}
          rows={4}
          className={cn(
            "w-full resize-none rounded-xl bg-white/[0.03] border border-white/[0.06]",
            "p-2.5 text-[12.5px] leading-relaxed placeholder:text-ink-400",
            "focus:outline-none focus:border-accent/30 focus:bg-white/[0.05]",
            "scrollbar-thin"
          )}
        />
      </Section>

      <Section icon={<Wand2 className="h-3.5 w-3.5" />} title="Turn detection">
        <Slider
          label="Threshold"
          min={0.1}
          max={0.9}
          step={0.05}
          value={value.vad.threshold}
          onChange={(v) => update("vad", { threshold: v })}
          suffix=""
          disabled={locked}
        />
        <Slider
          label="Silence"
          min={0}
          max={2000}
          step={50}
          value={value.vad.silence_duration_ms}
          onChange={(v) => update("vad", { silence_duration_ms: v })}
          suffix=" ms"
          disabled={locked}
        />
        <Slider
          label="Prefix pad"
          min={0}
          max={1000}
          step={33}
          value={value.vad.prefix_padding_ms}
          onChange={(v) => update("vad", { prefix_padding_ms: v })}
          suffix=" ms"
          disabled={locked}
        />
      </Section>

      <Section icon={<Wrench className="h-3.5 w-3.5" />} title="Tools">
        <CompactRow
          label="Web search"
          icon={<Globe className="h-3.5 w-3.5" />}
          checked={value.tools.web_search}
          onChange={(v) => update("tools", { web_search: v })}
          disabled={locked}
        />
        <CompactRow
          label="X search"
          icon={<SearchIcon className="h-3.5 w-3.5" />}
          checked={value.tools.x_search}
          onChange={(v) => update("tools", { x_search: v })}
          disabled={locked}
        />
        {value.tools.x_search && (
          <input
            type="text"
            placeholder="elonmusk, xai (optional handles)"
            value={value.tools.x_handles}
            onChange={(e) =>
              update("tools", { x_handles: e.target.value })
            }
            disabled={locked}
            className="input text-[12px] py-1.5 mt-1 mb-2"
          />
        )}
        <CompactRow
          label="get_current_time()"
          checked={value.tools.get_current_time}
          onChange={(v) => update("tools", { get_current_time: v })}
          disabled={locked}
        />
        <CompactRow
          label="generate_random_number()"
          checked={value.tools.generate_random_number}
          onChange={(v) =>
            update("tools", { generate_random_number: v })
          }
          disabled={locked}
        />
      </Section>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 pb-4 border-b border-white/5 last:border-b-0 last:pb-0 last:mb-0">
      <div className="flex items-center gap-1.5 mb-2 text-[11px] uppercase tracking-wider text-ink-400">
        {icon}
        {title}
      </div>
      {children}
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
        "w-full flex items-center justify-between py-1.5 text-[12.5px] text-ink-100",
        "hover:text-ink-50 transition-colors",
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

function Slider({
  label,
  min,
  max,
  step,
  value,
  suffix,
  onChange,
  disabled,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  suffix: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block mb-2.5 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-ink-300">{label}</span>
        <span className="text-[11px] text-ink-200 font-mono">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-full accent-accent-lime"
      />
    </label>
  );
}
