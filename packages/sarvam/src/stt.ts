import { toBase64 } from "./audio";
import type { SarvamLanguage, SarvamMode } from "./languages";

const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text/ws";
const MAX_QUEUED_CHUNKS = 200;
const DEFAULT_DEBOUNCE_MS = 350;

export type SarvamSttOptions = {
  apiKey: string;
  language?: SarvamLanguage;
  mode?: SarvamMode;
  sampleRate?: 8_000 | 16_000;
  keyterms?: string[];
  /** Sarvam emits one final per phrase; combine nearby finals into one turn. */
  debounceMs?: number;
  onUtterance: (text: string) => void;
  onError?: (error: Error) => void;
};

/**
 * One Sarvam streaming STT session. The voice pipeline calls `feed()` with
 * 16 kHz mono PCM and receives `onUtterance` after Sarvam's VAD closes a turn.
 */
export class SarvamSttSession {
  private socket: WebSocket | null = null;
  private readonly ready: Promise<void>;
  private readonly queue: Uint8Array[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingText = "";
  private lastSegment = "";
  private closed = false;

  constructor(private readonly options: SarvamSttOptions) {
    this.ready = this.open();
  }

  waitUntilReady(): Promise<void> {
    return this.ready;
  }

  feed(chunk: ArrayBuffer): void {
    if (this.closed) return;
    const bytes = new Uint8Array(chunk);
    if (bytes.byteLength === 0) return;

    if (!this.socket || this.socket.readyState !== 1) {
      if (this.queue.length < MAX_QUEUED_CHUNKS) {
        this.queue.push(bytes);
      }
      return;
    }

    this.send(bytes);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearDebounce();
    this.queue.length = 0;
    try {
      this.socket?.close(1000, "session closed");
    } catch {
      // Already closed.
    }
    this.socket = null;
  }

  private async open(): Promise<void> {
    const url = new URL(SARVAM_STT_URL);
    url.searchParams.set("language-code", this.options.language ?? "unknown");
    url.searchParams.set("model", "saaras:v4");
    url.searchParams.set("mode", this.options.mode ?? "transcribe");
    url.searchParams.set("sample_rate", String(this.options.sampleRate ?? 16_000));
    url.searchParams.set("input_audio_codec", "pcm_s16le");
    url.searchParams.set("high_vad_sensitivity", "true");
    if (this.options.keyterms && this.options.keyterms.length > 0) {
      url.searchParams.set("keyterms", JSON.stringify(this.options.keyterms));
    }

    const response = await fetch(url.toString(), {
      headers: {
        Upgrade: "websocket",
        "api-subscription-key": this.options.apiKey,
      },
    });

    const socket = response.webSocket;
    if (!socket) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Sarvam STT handshake failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    socket.accept();
    socket.addEventListener("message", (event: MessageEvent) => {
      this.handleMessage(event.data);
    });
    socket.addEventListener("error", () => {
      if (!this.closed) {
        this.options.onError?.(new Error("Sarvam STT socket error"));
      }
    });
    socket.addEventListener("close", (event: CloseEvent) => {
      if (this.closed) return;
      this.closed = true;
      this.clearDebounce();
      if (event.code !== 1000) {
        this.options.onError?.(
          new Error(`Sarvam STT closed (${event.code}): ${event.reason.slice(0, 200)}`),
        );
      }
    });

    this.socket = socket;
    for (const chunk of this.queue) {
      this.send(chunk);
    }
    this.queue.length = 0;
  }

  private send(bytes: Uint8Array): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return;
    socket.send(
      JSON.stringify({
        audio: {
          data: toBase64(bytes),
          sample_rate: this.options.sampleRate ?? 16_000,
          encoding: "audio/wav",
        },
      }),
    );
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;

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
      const detail =
        typeof payload.data?.message === "string" ? payload.data.message : "unknown error";
      this.options.onError?.(new Error(`Sarvam STT error: ${detail}`));
      this.close();
      return;
    }

    if (payload.type !== "data") return;

    const transcript =
      typeof payload.data?.transcript === "string" ? payload.data.transcript.trim() : "";
    if (transcript.length === 0) return;

    // Sarvam may repeat a segment after a reconnect.
    if (transcript === this.lastSegment) return;
    this.lastSegment = transcript;

    this.pendingText = this.pendingText ? `${this.pendingText} ${transcript}` : transcript;
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      const text = this.pendingText.trim();
      this.pendingText = "";
      if (text.length > 0 && !this.closed) {
        this.options.onUtterance(text);
      }
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }
}
