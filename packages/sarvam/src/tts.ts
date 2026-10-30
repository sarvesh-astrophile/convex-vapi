import { fromBase64, toArrayBuffer, wavToPcm } from "./audio";
import type { SarvamLanguage, SarvamTtsModel } from "./languages";

const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";
const MAX_TTS_CHARACTERS = 2_500;

export type SarvamTtsOptions = {
  apiKey: string;
  language?: SarvamLanguage;
  speaker?: string;
  model?: SarvamTtsModel;
  /** Voice-agent PCM rate. Sarvam supports 8k through 48k. */
  sampleRate?: 8_000 | 16_000 | 22_050 | 24_000;
};

/**
 * Sarvam Bulbul adapter for `agents/voice`. `synthesize` returns raw mono
 * 16-bit PCM with no container header, which is what the voice pipeline and
 * telephony adapters expect.
 */
export class SarvamTtsProvider {
  constructor(private readonly options: SarvamTtsOptions) {}

  async synthesize(text: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > MAX_TTS_CHARACTERS) {
      throw new Error(`Sarvam TTS text exceeds ${MAX_TTS_CHARACTERS} characters`);
    }

    const sampleRate = this.options.sampleRate ?? 16_000;
    const response = await fetch(SARVAM_TTS_URL, {
      method: "POST",
      headers: {
        "api-subscription-key": this.options.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: trimmed,
        language_code: this.options.language ?? "hi-IN",
        speaker: this.options.speaker ?? "shubh",
        model: this.options.model ?? "bulbul:v3",
        speech_sample_rate: sampleRate,
        output_audio_codec: "wav",
        enable_preprocessing: true,
      }),
      signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Sarvam TTS failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    const body = (await response.json()) as { audios?: unknown };
    const audios = Array.isArray(body.audios)
      ? body.audios.filter((item): item is string => typeof item === "string")
      : [];
    const base64 = audios.join("");
    if (base64.length === 0) {
      throw new Error("Sarvam TTS returned no audio");
    }

    return toArrayBuffer(wavToPcm(fromBase64(base64)));
  }

  async *synthesizeStream(text: string, signal?: AbortSignal): AsyncGenerator<ArrayBuffer> {
    const audio = await this.synthesize(text, signal);
    if (audio) yield audio;
  }
}
