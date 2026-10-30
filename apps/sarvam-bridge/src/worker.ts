import { DurableObject } from "cloudflare:workers";

import { splitStereo, toBase64 } from "./audio";
import {
  parseBridgeConfig,
  parseVoiceConfig,
  verifyBridgeSignature,
  verifyVoiceSignature,
  type BridgeConfig,
} from "./protocol";

export interface Env {
  SARVAM_SESSION: DurableObjectNamespace<SarvamSession>;
  SARVAM_API_KEY: string;
  SARVAM_BRIDGE_SECRET: string;
  SARVAM_BRIDGE_SIGNING_SECRET: string;
}

// `fetch` only accepts http(s) URLs in Workers; the Upgrade header performs
// the WebSocket handshake and the response carries the `webSocket`.
const SARVAM_WS_URL = "https://api.sarvam.ai/speech-to-text/ws";
const MAX_PENDING_CHUNKS = 240;
const MAX_PENDING_BYTES = 1_500_000;
// Sarvam emits one final per phrase. Vapi treats every final as a user turn,
// so combine back-to-back phrases before forwarding.
const TRANSCRIPT_DEBOUNCE_MS = 350;

type Channel = "customer" | "assistant";
type PendingChunk = { channel: Channel; bytes: Uint8Array };

type Session = {
  config: BridgeConfig;
  vapi: WebSocket;
  sampleRate: number;
  channels: number;
  started: boolean;
  closing: boolean;
  sarvam: Partial<Record<Channel, WebSocket>>;
  pending: PendingChunk[];
  pendingBytes: number;
  lastSegment: Partial<Record<Channel, string>>;
  pendingTranscript: Partial<Record<Channel, string>>;
  transcriptTimer: Partial<Record<Channel, number>>;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/") {
      return Response.json({
        service: "sarvam-stt-bridge",
        endpoints: {
          transcriber: "/v1/transcriber",
          voice: "/v1/voice",
        },
        health: "/healthz",
      });
    }

    if (url.pathname === "/v1/voice") {
      return await handleVoice(request, env, url);
    }

    if (url.pathname !== "/v1/transcriber") {
      return new Response("Not found", { status: 404 });
    }

    if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    if (!constantTimeEqual(request.headers.get("x-vapi-secret") ?? "", env.SARVAM_BRIDGE_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const parsed = parseBridgeConfig(url);
    if (!parsed.ok) {
      return new Response(parsed.error, { status: 400 });
    }

    const signature = url.searchParams.get("sig") ?? "";
    if (
      !(await verifyBridgeSignature(env.SARVAM_BRIDGE_SIGNING_SECRET, parsed.config, signature))
    ) {
      return new Response("Forbidden", { status: 403 });
    }

    if (!env.SARVAM_API_KEY) {
      return new Response("Sarvam API key is not configured", { status: 503 });
    }

    const name = `${parsed.config.agent}:${crypto.randomUUID()}`;
    // Vapi's edge and Sarvam are both closest to APAC for Indian traffic.
    const stub = env.SARVAM_SESSION.getByName(name, { locationHint: "apac" });
    return await stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class SarvamSession extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const parsed = parseBridgeConfig(new URL(request.url));
    if (!parsed.ok) {
      return new Response(parsed.error, { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const session: Session = {
      config: parsed.config,
      vapi: server,
      sampleRate: 16_000,
      channels: 2,
      started: false,
      closing: false,
      sarvam: {},
      pending: [],
      pendingBytes: 0,
      lastSegment: {},
      pendingTranscript: {},
      transcriptTimer: {},
    };

    server.addEventListener("message", (event: MessageEvent) => {
      void this.handleMessage(session, event.data as unknown);
    });
    server.addEventListener("close", () => {
      this.shutdown(session, "vapi-closed", false);
    });
    server.addEventListener("error", () => {
      this.shutdown(session, "vapi-error", false);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleMessage(session: Session, data: unknown): Promise<void> {
    if (session.closing) return;

    if (typeof data === "string") {
      await this.handleControl(session, data);
      return;
    }

    const buffer = await toArrayBuffer(data);
    if (!buffer) {
      console.log("sarvam-bridge: unexpected Vapi message", {
        agent: session.config.agent,
        type: typeof data,
        tag: Object.prototype.toString.call(data),
      });
      return;
    }

    this.handleAudio(session, buffer);
  }

  private async handleControl(session: Session, raw: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (typeof message !== "object" || message === null) return;
    const control = message as { type?: unknown; sampleRate?: unknown; channels?: unknown };
    if (control.type !== "start" || session.started) return;

    session.started = true;
    session.sampleRate = normalizeSampleRate(control.sampleRate);
    session.channels = control.channels === 1 ? 1 : 2;

    await this.openSarvam(session);
  }

  private async openSarvam(session: Session): Promise<void> {
    const channels: Channel[] =
      session.config.channels === "both" ? ["customer", "assistant"] : ["customer"];

    const results = await Promise.allSettled(
      channels.map(async (channel) => await this.connectSarvam(session, channel)),
    );

    const customerResult = results[0];
    if (!customerResult || customerResult.status === "rejected") {
      const message =
        customerResult?.status === "rejected" ? describeError(customerResult.reason) : "no session";
      console.error("sarvam-bridge: failed to open customer STT", {
        agent: session.config.agent,
        error: message,
      });
      this.shutdown(session, "sarvam-open-failed", true);
      return;
    }

    console.log("sarvam-bridge: STT sessions ready", {
      agent: session.config.agent,
      lang: session.config.lang,
      mode: session.config.mode,
      sampleRate: session.sampleRate,
      channels,
    });

    this.flushPending(session);
  }

  private async connectSarvam(session: Session, channel: Channel): Promise<void> {
    const url = new URL(SARVAM_WS_URL);
    url.searchParams.set("language-code", session.config.lang);
    url.searchParams.set("model", "saaras:v4");
    url.searchParams.set("mode", session.config.mode);
    url.searchParams.set("sample_rate", String(session.sampleRate));
    url.searchParams.set("input_audio_codec", "pcm_s16le");
    url.searchParams.set("high_vad_sensitivity", "true");
    if (session.config.keyterms.length > 0) {
      url.searchParams.set("keyterms", JSON.stringify(session.config.keyterms));
    }

    const response = await fetch(url.toString(), {
      headers: {
        Upgrade: "websocket",
        "Api-Subscription-Key": this.env.SARVAM_API_KEY,
      },
    });

    const socket = response.webSocket;
    if (!socket) {
      const body = await response.text().catch(() => "");
      throw new Error(`Sarvam handshake failed (${response.status}): ${body.slice(0, 300)}`);
    }

    socket.accept();

    socket.addEventListener("message", (event: MessageEvent) => {
      this.handleSarvamMessage(session, channel, event.data);
    });
    socket.addEventListener("close", (event: CloseEvent) => {
      if (session.closing) return;
      console.error("sarvam-bridge: Sarvam socket closed", {
        agent: session.config.agent,
        channel,
        code: event.code,
        reason: event.reason.slice(0, 200),
      });
      // A 4xxx close is an auth/quota problem; retrying would just burn calls.
      if (channel === "customer") {
        this.shutdown(session, `sarvam-closed-${event.code}`, true);
      }
    });
    socket.addEventListener("error", () => {
      if (session.closing) return;
      console.error("sarvam-bridge: Sarvam socket error", {
        agent: session.config.agent,
        channel,
      });
      if (channel === "customer") {
        this.shutdown(session, "sarvam-error", true);
      }
    });

    session.sarvam[channel] = socket;
  }

  private handleSarvamMessage(session: Session, channel: Channel, data: unknown): void {
    if (session.closing || typeof data !== "string") return;

    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) return;

    const payload = message as {
      type?: unknown;
      data?: { transcript?: unknown; message?: unknown; code?: unknown };
    };

    if (payload.type === "error") {
      console.error("sarvam-bridge: Sarvam error message", {
        agent: session.config.agent,
        channel,
        code: payload.data?.code,
        message: payload.data?.message,
      });
      if (channel === "customer") {
        this.shutdown(session, "sarvam-error-message", true);
      }
      return;
    }

    if (payload.type !== "data") return;

    const transcript =
      typeof payload.data?.transcript === "string" ? payload.data.transcript.trim() : "";
    if (transcript.length === 0) return;

    // Sarvam may repeat the same segment after a reconnect; skip duplicates.
    if (session.lastSegment[channel] === transcript) return;
    session.lastSegment[channel] = transcript;

    const existing = session.pendingTranscript[channel];
    session.pendingTranscript[channel] = existing ? `${existing} ${transcript}` : transcript;

    const timer = session.transcriptTimer[channel];
    if (timer !== undefined) clearTimeout(timer);
    session.transcriptTimer[channel] = setTimeout(() => {
      this.flushTranscript(session, channel);
    }, TRANSCRIPT_DEBOUNCE_MS) as unknown as number;
  }

  private flushTranscript(session: Session, channel: Channel): void {
    const timer = session.transcriptTimer[channel];
    if (timer !== undefined) clearTimeout(timer);
    delete session.transcriptTimer[channel];

    const transcript = (session.pendingTranscript[channel] ?? "").trim();
    delete session.pendingTranscript[channel];
    if (transcript.length === 0 || session.closing) return;

    if (session.vapi.readyState !== 1) return;
    session.vapi.send(
      JSON.stringify({
        type: "transcriber-response",
        transcription: transcript,
        channel,
        transcriptType: "final",
      }),
    );
  }

  private handleAudio(session: Session, buffer: ArrayBuffer): void {
    if (session.channels === 1) {
      this.sendAudio(session, "customer", new Uint8Array(buffer));
      return;
    }

    const { customer, assistant } = splitStereo(buffer);
    this.sendAudio(session, "customer", customer);
    if (session.config.channels === "both") {
      this.sendAudio(session, "assistant", assistant);
    }
  }

  private sendAudio(session: Session, channel: Channel, bytes: Uint8Array): void {
    if (bytes.length === 0 || session.closing) return;

    const socket = session.sarvam[channel];
    if (!socket || socket.readyState !== 1) {
      this.enqueue(session, channel, bytes);
      return;
    }

    socket.send(
      JSON.stringify({
        audio: {
          data: toBase64(bytes),
          sample_rate: session.sampleRate,
          encoding: "audio/wav",
        },
      }),
    );
  }

  private enqueue(session: Session, channel: Channel, bytes: Uint8Array): void {
    if (
      session.pending.length >= MAX_PENDING_CHUNKS ||
      session.pendingBytes + bytes.length > MAX_PENDING_BYTES
    ) {
      return;
    }
    session.pending.push({ channel, bytes });
    session.pendingBytes += bytes.length;
  }

  private flushPending(session: Session): void {
    const pending = session.pending;
    session.pending = [];
    session.pendingBytes = 0;
    for (const chunk of pending) {
      this.sendAudio(session, chunk.channel, chunk.bytes);
    }
  }

  private shutdown(session: Session, reason: string, closeVapi: boolean): void {
    if (session.closing) return;
    session.closing = true;
    session.pending = [];
    session.pendingBytes = 0;
    session.pendingTranscript = {};
    for (const timer of Object.values(session.transcriptTimer)) {
      if (timer !== undefined) clearTimeout(timer);
    }
    session.transcriptTimer = {};

    for (const socket of Object.values(session.sarvam)) {
      try {
        socket?.close(1000, reason.slice(0, 120));
      } catch {
        // Already closed.
      }
    }
    session.sarvam = {};

    if (closeVapi) {
      try {
        if (session.vapi.readyState === 1) {
          // 1011 tells Vapi the transcriber failed so it can use its fallback.
          session.vapi.close(1011, reason.slice(0, 120));
        }
      } catch {
        // Already closed.
      }
    }
  }
}

const VOICE_SAMPLE_RATES = [8000, 16_000, 22_050, 24_000, 44_100] as const;
const MAX_TTS_CHARACTERS = 2_500;

async function handleVoice(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!constantTimeEqual(request.headers.get("x-vapi-secret") ?? "", env.SARVAM_BRIDGE_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parsed = parseVoiceConfig(url);
  if (!parsed.ok) {
    return new Response(parsed.error, { status: 400 });
  }

  const signature = url.searchParams.get("sig") ?? "";
  if (!(await verifyVoiceSignature(env.SARVAM_BRIDGE_SIGNING_SECRET, parsed.config, signature))) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!env.SARVAM_API_KEY) {
    return new Response("Sarvam API key is not configured", { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return new Response("Invalid request body", { status: 400 });
  }

  const message = (body as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) {
    return new Response("Missing message object", { status: 400 });
  }

  const voiceRequest = message as { type?: unknown; text?: unknown; sampleRate?: unknown };
  if (voiceRequest.type !== "voice-request") {
    return new Response("Expected a voice-request message", { status: 400 });
  }

  const text = typeof voiceRequest.text === "string" ? voiceRequest.text.trim() : "";
  if (text.length === 0) {
    return new Response("Missing text", { status: 400 });
  }
  if (text.length > MAX_TTS_CHARACTERS) {
    return new Response(`Text exceeds ${MAX_TTS_CHARACTERS} characters`, { status: 400 });
  }

  const sampleRate =
    typeof voiceRequest.sampleRate === "number" &&
    (VOICE_SAMPLE_RATES as readonly number[]).includes(voiceRequest.sampleRate)
      ? voiceRequest.sampleRate
      : 16_000;

  try {
    const upstream = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": env.SARVAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        language_code: parsed.config.lang,
        speaker: parsed.config.speaker,
        model: parsed.config.model,
        speech_sample_rate: sampleRate,
        output_audio_codec: "wav",
        enable_preprocessing: true,
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error("sarvam-bridge: TTS request failed", {
        agent: parsed.config.agent,
        status: upstream.status,
        detail: detail.slice(0, 300),
      });
      return new Response("Sarvam TTS request failed", { status: 502 });
    }

    const response = (await upstream.json()) as { audios?: unknown };
    const audios = Array.isArray(response.audios)
      ? response.audios.filter((item): item is string => typeof item === "string")
      : [];
    const base64 = audios.join("");
    if (base64.length === 0) {
      return new Response("Sarvam TTS returned no audio", { status: 502 });
    }

    const pcm = wavToPcm(fromBase64(base64));
    if (pcm.byteLength === 0) {
      return new Response("Sarvam TTS returned empty audio", { status: 502 });
    }

    return new Response(pcm, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(pcm.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("sarvam-bridge: TTS request threw", {
      agent: parsed.config.agent,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response("Sarvam TTS request failed", { status: 502 });
  }
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Sarvam returns a base64 WAV; Vapi needs headerless 16-bit mono PCM. */
function wavToPcm(wav: Uint8Array): Uint8Array {
  if (wav.byteLength < 12) {
    throw new Error("Invalid WAV: too short");
  }

  const riff = String.fromCharCode(...wav.subarray(0, 4));
  if (riff !== "RIFF") {
    throw new Error("Invalid WAV: missing RIFF header");
  }

  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let offset = 12;
  while (offset + 8 <= wav.byteLength) {
    const id = String.fromCharCode(...wav.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      const start = offset + 8;
      return wav.subarray(start, Math.min(start + size, wav.byteLength));
    }
    offset += 8 + size + (size % 2);
  }

  throw new Error("Invalid WAV: missing data chunk");
}

function normalizeSampleRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 16_000;
  // Sarvam's connection parameter supports 8 kHz and 16 kHz.
  return value === 8_000 ? 8_000 : 16_000;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * WebSocket binary frames arrive as ArrayBuffer in Workers and may arrive as a
 * Buffer/Blob under local emulation. Normalize all of them.
 */
async function toArrayBuffer(data: unknown): Promise<ArrayBuffer | null> {
  if (data instanceof ArrayBuffer) return data;

  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }

  if (typeof data === "object" && data !== null) {
    const candidate = data as { arrayBuffer?: unknown };
    if (typeof candidate.arrayBuffer === "function") {
      return await (candidate.arrayBuffer as () => Promise<ArrayBuffer>)();
    }
  }

  return null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let mismatch = a.length === b.length ? 0 : 1;
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}
