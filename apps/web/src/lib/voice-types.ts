export type ConnectionState = "idle" | "connecting" | "active" | "ending" | "ended" | "error";

export type LiveTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

/**
 * One turn's timing summary, mapped from the voice SDK's `VoiceTurnMetrics`.
 *
 * All values are measured server-side inside the Durable Object, on a single
 * clock. Browser playback and network transit are excluded, so the headline
 * "reply" number is the time from a finalized transcript to the first audio
 * byte leaving the runtime — not what the caller perceives.
 */
export type TurnLatency = {
  turnId: string;
  /** `completed` | `no_output` | `model_error` | `tts_error` | … */
  outcome: string;
  at: number;
  /** Headline: finalized transcript -> first server audio. */
  replyMs?: number;
  /** Speech end -> finalized transcript (STT endpointing). */
  sttFinalMs?: number;
  /** Model invocation -> first text token. */
  modelFirstTextMs?: number;
  /** TTS invocation -> first audio. */
  ttsFirstAudioMs?: number;
  turnTotalMs: number;
};

/** The last pipeline snapshot reported by the SDK (server-side wall clock). */
export type PipelineLatency = {
  llmMs: number;
  ttsMs: number;
  firstAudioMs: number;
  totalMs: number;
};
