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
