/**
 * Shared contract between the Sarvam STT bridge Worker and whoever signs its
 * URLs (for now the `sign-url` script; later the Convex publish action).
 *
 * Keep this file dependency-free: it runs in Workers, Bun, and Node.
 */

export const SARVAM_MODES = ["transcribe", "codemix", "translit", "translate", "verbatim"] as const;

export type SarvamMode = (typeof SARVAM_MODES)[number];

/** Languages accepted by Sarvam's streaming endpoint. */
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

export const SARVAM_TTS_MODELS = ["bulbul:v3", "bulbul:v4-flash"] as const;
export type SarvamTtsModel = (typeof SARVAM_TTS_MODELS)[number];

export const BRIDGE_CHANNELS = ["customer", "both"] as const;
export type BridgeChannels = (typeof BRIDGE_CHANNELS)[number];

export type BridgeConfig = {
  /** Opaque agent/assistant identifier. Only used for logs and DO naming. */
  agent: string;
  lang: SarvamLanguage;
  mode: SarvamMode;
  channels: BridgeChannels;
  keyterms: string[];
};

export type ParseResult = { ok: true; config: BridgeConfig } | { ok: false; error: string };

export type VoiceConfig = {
  agent: string;
  lang: SarvamLanguage;
  speaker: string;
  model: SarvamTtsModel;
};

export type VoiceParseResult = { ok: true; config: VoiceConfig } | { ok: false; error: string };

export const MAX_AGENT_LENGTH = 128;
export const MAX_KEYTERMS = 50;
export const MAX_KEYTERM_LENGTH = 64;

const CANONICAL_VERSION = "v1";
const VOICE_CANONICAL_VERSION = "voice-v1";
const AGENT_PATTERN = /^[A-Za-z0-9:_-]+$/;
const SPEAKER_PATTERN = /^[A-Za-z0-9_-]+$/;

export function canonicalPayload(config: BridgeConfig): string {
  return [
    CANONICAL_VERSION,
    config.agent,
    config.lang,
    config.mode,
    config.channels,
    config.keyterms.join(","),
  ].join("\n");
}

export function toSearchParams(config: BridgeConfig): URLSearchParams {
  const params = new URLSearchParams();
  params.set("agent", config.agent);
  params.set("lang", config.lang);
  params.set("mode", config.mode);
  params.set("channels", config.channels);
  if (config.keyterms.length > 0) {
    params.set("keyterms", config.keyterms.join(","));
  }
  return params;
}

export function parseBridgeConfig(url: URL): ParseResult {
  const agent = (url.searchParams.get("agent") ?? "").trim();
  if (agent.length === 0 || agent.length > MAX_AGENT_LENGTH) {
    return { ok: false, error: "agent must be 1-128 characters" };
  }
  if (!AGENT_PATTERN.test(agent)) {
    return { ok: false, error: "agent may only contain letters, digits, ':', '_', and '-'" };
  }

  const lang = url.searchParams.get("lang") ?? "unknown";
  if (!isOneOf(SARVAM_LANGUAGES, lang)) {
    return { ok: false, error: `unsupported lang: ${lang}` };
  }

  const mode = url.searchParams.get("mode") ?? "transcribe";
  if (!isOneOf(SARVAM_MODES, mode)) {
    return { ok: false, error: `unsupported mode: ${mode}` };
  }

  const channels = url.searchParams.get("channels") ?? "customer";
  if (!isOneOf(BRIDGE_CHANNELS, channels)) {
    return { ok: false, error: `unsupported channels: ${channels}` };
  }

  const keyterms: string[] = [];
  for (const raw of (url.searchParams.get("keyterms") ?? "").split(",")) {
    const term = raw.trim();
    if (term.length === 0) continue;
    if (term.length > MAX_KEYTERM_LENGTH) {
      return { ok: false, error: `keyterm exceeds ${MAX_KEYTERM_LENGTH} characters` };
    }
    keyterms.push(term);
  }
  if (keyterms.length > MAX_KEYTERMS) {
    return { ok: false, error: `at most ${MAX_KEYTERMS} keyterms are allowed` };
  }

  return { ok: true, config: { agent, lang, mode, channels, keyterms } };
}

export function parseVoiceConfig(url: URL): VoiceParseResult {
  const agent = (url.searchParams.get("agent") ?? "").trim();
  if (agent.length === 0 || agent.length > MAX_AGENT_LENGTH) {
    return { ok: false, error: "agent must be 1-128 characters" };
  }
  if (!AGENT_PATTERN.test(agent)) {
    return { ok: false, error: "agent may only contain letters, digits, ':', '_', and '-'" };
  }

  const lang = url.searchParams.get("lang") ?? "hi-IN";
  if (!isOneOf(SARVAM_LANGUAGES, lang)) {
    return { ok: false, error: `unsupported lang: ${lang}` };
  }
  if (lang === "unknown") {
    return { ok: false, error: "voice lang must be a specific language code" };
  }

  const speaker = (url.searchParams.get("speaker") ?? "shubh").trim();
  if (speaker.length === 0 || speaker.length > 64 || !SPEAKER_PATTERN.test(speaker)) {
    return { ok: false, error: "speaker must be 1-64 letters, digits, '_' or '-'" };
  }

  const model = url.searchParams.get("model") ?? "bulbul:v3";
  if (!isOneOf(SARVAM_TTS_MODELS, model)) {
    return { ok: false, error: `unsupported TTS model: ${model}` };
  }

  return { ok: true, config: { agent, lang, speaker, model } };
}

export function toVoiceSearchParams(config: VoiceConfig): URLSearchParams {
  const params = new URLSearchParams();
  params.set("agent", config.agent);
  params.set("lang", config.lang);
  params.set("speaker", config.speaker);
  params.set("model", config.model);
  return params;
}

export function canonicalVoicePayload(config: VoiceConfig): string {
  return [VOICE_CANONICAL_VERSION, config.agent, config.lang, config.speaker, config.model].join(
    "\n",
  );
}

export async function signBridgeConfig(secret: string, config: BridgeConfig): Promise<string> {
  return await signPayload(secret, canonicalPayload(config));
}

export async function verifyBridgeSignature(
  secret: string,
  config: BridgeConfig,
  signature: string,
): Promise<boolean> {
  return await verifyPayload(secret, canonicalPayload(config), signature);
}

export async function signVoiceConfig(secret: string, config: VoiceConfig): Promise<string> {
  return await signPayload(secret, canonicalVoicePayload(config));
}

export async function verifyVoiceSignature(
  secret: string,
  config: VoiceConfig,
  signature: string,
): Promise<boolean> {
  return await verifyPayload(secret, canonicalVoicePayload(config), signature);
}

async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toHex(new Uint8Array(signature));
}

async function verifyPayload(secret: string, payload: string, signature: string): Promise<boolean> {
  const bytes = fromHex(signature);
  if (!bytes) return false;

  const key = await importHmacKey(secret);
  return await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(payload));
}

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/i.test(hex)) return null;

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const value = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    if (Number.isNaN(value)) return null;
    bytes[index] = value;
  }
  return bytes;
}
