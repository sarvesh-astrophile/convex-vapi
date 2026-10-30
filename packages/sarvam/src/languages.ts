/** Languages supported by Sarvam's streaming STT endpoint. */
export const SARVAM_LANGUAGES = [
  "unknown",
  "en-IN",
  "hi-IN",
  "bn-IN",
  "gu-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "od-IN",
  "pa-IN",
  "ta-IN",
  "te-IN",
  "as-IN",
  "ur-IN",
  "ne-IN",
  "kok-IN",
  "ks-IN",
  "sd-IN",
  "sa-IN",
  "sat-IN",
  "mni-IN",
  "brx-IN",
  "mai-IN",
  "doi-IN",
] as const;

export type SarvamLanguage = (typeof SARVAM_LANGUAGES)[number];

export const SARVAM_MODES = ["transcribe", "codemix", "translit", "translate", "verbatim"] as const;

export type SarvamMode = (typeof SARVAM_MODES)[number];

export const SARVAM_TTS_MODELS = ["bulbul:v3", "bulbul:v4-flash"] as const;
export type SarvamTtsModel = (typeof SARVAM_TTS_MODELS)[number];

export function isSarvamLanguage(value: string): value is SarvamLanguage {
  return (SARVAM_LANGUAGES as readonly string[]).includes(value);
}

export function isSarvamMode(value: string): value is SarvamMode {
  return (SARVAM_MODES as readonly string[]).includes(value);
}

/** Map the app's short language codes to Sarvam BCP-47 codes. */
export function toSarvamLanguage(value: string): SarvamLanguage {
  const normalized = value.trim().toLowerCase();
  if (normalized === "multi" || normalized === "auto" || normalized === "") {
    return "unknown";
  }
  if (normalized.length === 2) {
    const candidate = `${normalized}-IN`;
    if (isSarvamLanguage(candidate)) return candidate;
  }
  return isSarvamLanguage(value) ? value : "unknown";
}
