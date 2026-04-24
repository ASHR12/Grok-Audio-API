export const STT_LANGUAGES: { code: string; name: string }[] = [
  { code: "", name: "Auto (no formatting)" },
  { code: "en", name: "English" },
  { code: "ar", name: "Arabic" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "nl", name: "Dutch" },
  { code: "fil", name: "Filipino" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonesian" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "mk", name: "Macedonian" },
  { code: "ms", name: "Malay" },
  { code: "fa", name: "Persian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "es", name: "Spanish" },
  { code: "sv", name: "Swedish" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "vi", name: "Vietnamese" },
];

export const TTS_LANGUAGES: { code: string; name: string }[] = [
  { code: "auto", name: "Auto-detect" },
  { code: "en", name: "English" },
  { code: "ar-EG", name: "Arabic (Egypt)" },
  { code: "ar-SA", name: "Arabic (Saudi Arabia)" },
  { code: "ar-AE", name: "Arabic (UAE)" },
  { code: "bn", name: "Bengali" },
  { code: "zh", name: "Chinese (Simplified)" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonesian" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "pt-BR", name: "Portuguese (Brazil)" },
  { code: "pt-PT", name: "Portuguese (Portugal)" },
  { code: "ru", name: "Russian" },
  { code: "es-MX", name: "Spanish (Mexico)" },
  { code: "es-ES", name: "Spanish (Spain)" },
  { code: "tr", name: "Turkish" },
  { code: "vi", name: "Vietnamese" },
];

export type VoiceId = "eve" | "ara" | "rex" | "sal" | "leo";

export const VOICES: {
  id: VoiceId;
  name: string;
  tone: string;
  description: string;
}[] = [
  {
    id: "eve",
    name: "Eve",
    tone: "Energetic · upbeat",
    description: "Default voice — engaging and enthusiastic.",
  },
  {
    id: "ara",
    name: "Ara",
    tone: "Warm · friendly",
    description: "Balanced and conversational.",
  },
  {
    id: "rex",
    name: "Rex",
    tone: "Confident · clear",
    description: "Professional and articulate — ideal for business.",
  },
  {
    id: "sal",
    name: "Sal",
    tone: "Smooth · balanced",
    description: "Versatile voice for a wide range of contexts.",
  },
  {
    id: "leo",
    name: "Leo",
    tone: "Authoritative · strong",
    description: "Commanding and decisive — great for instructional content.",
  },
];

// ----------- Voice Agent -----------

export type AgentModelId =
  | "grok-voice-think-fast-1.0"
  | "grok-voice-fast-1.0";

export const AGENT_MODELS: {
  id: AgentModelId;
  label: string;
  tag: "new" | "legacy";
  description: string;
}[] = [
  {
    id: "grok-voice-think-fast-1.0",
    label: "Grok Voice Think Fast 1.0",
    tag: "new",
    description:
      "Flagship — real-time background reasoning, best for complex tool use and high-stakes workflows.",
  },
  {
    id: "grok-voice-fast-1.0",
    label: "Grok Voice Fast 1.0",
    tag: "legacy",
    description: "Legacy voice model — kept for compatibility.",
  },
];

export const AGENT_VAD_DEFAULTS = {
  threshold: 0.85,
  silence_duration_ms: 500,
  prefix_padding_ms: 333,
};

export const AGENT_SAMPLE_RATE = 24000;

export const AGENT_INSTRUCTION_PRESETS: {
  id: string;
  name: string;
  text: string;
}[] = [
  {
    id: "default",
    name: "Helpful assistant",
    text:
      "You are Grok, a helpful, conversational voice assistant. Keep replies concise and natural since they are spoken aloud. Use short sentences, avoid long lists, and ask a clarifying question when the user's intent is unclear.",
  },
  {
    id: "support",
    name: "Customer support",
    text:
      "You are a friendly customer support agent. Gather the customer's name, issue, and any relevant identifiers before attempting to resolve. Confirm information by reading it back. Keep responses warm, succinct, and solution-focused.",
  },
  {
    id: "interviewer",
    name: "Interviewer",
    text:
      "You are a thoughtful interviewer. Ask one open-ended question at a time, let the user talk, and follow up with clarifications. Do not lecture — listen.",
  },
  {
    id: "tutor",
    name: "Patient tutor",
    text:
      "You are a patient tutor. Explain concepts in simple language, use short analogies, and check understanding with a quick question after each idea.",
  },
];

export type AgentToolConfig =
  | { type: "web_search"; enabled: boolean }
  | { type: "x_search"; enabled: boolean; allowed_x_handles?: string[] }
  | {
      type: "function";
      enabled: boolean;
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };

export const AGENT_BUILTIN_FUNCTIONS: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mock: (args: Record<string, unknown>) => unknown;
}[] = [
  {
    name: "get_current_time",
    description:
      "Get the current date and time in the user's local timezone. Use this whenever the user asks about time, date, or day.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    mock: () => {
      const now = new Date();
      return {
        iso: now.toISOString(),
        local: now.toLocaleString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    },
  },
  {
    name: "generate_random_number",
    description: "Generate a random integer between min and max (inclusive).",
    parameters: {
      type: "object",
      properties: {
        min: { type: "number", description: "Minimum (inclusive)" },
        max: { type: "number", description: "Maximum (inclusive)" },
      },
      required: ["min", "max"],
    },
    mock: (args) => {
      const a = args as { min: number; max: number };
      const lo = Math.min(a.min, a.max);
      const hi = Math.max(a.min, a.max);
      return { value: Math.floor(Math.random() * (hi - lo + 1)) + lo };
    },
  },
];

export const SPEECH_TAG_PRESETS = [
  { label: "[pause]", insert: "[pause] ", kind: "inline" },
  { label: "[long-pause]", insert: "[long-pause] ", kind: "inline" },
  { label: "[laugh]", insert: "[laugh] ", kind: "inline" },
  { label: "[chuckle]", insert: "[chuckle] ", kind: "inline" },
  { label: "[sigh]", insert: "[sigh] ", kind: "inline" },
  { label: "[breath]", insert: "[breath] ", kind: "inline" },
  { label: "<whisper>", insert: "<whisper>TEXT</whisper>", kind: "wrap" },
  { label: "<soft>", insert: "<soft>TEXT</soft>", kind: "wrap" },
  { label: "<emphasis>", insert: "<emphasis>TEXT</emphasis>", kind: "wrap" },
  { label: "<slow>", insert: "<slow>TEXT</slow>", kind: "wrap" },
  { label: "<fast>", insert: "<fast>TEXT</fast>", kind: "wrap" },
  { label: "<sing-song>", insert: "<sing-song>TEXT</sing-song>", kind: "wrap" },
] as const;
