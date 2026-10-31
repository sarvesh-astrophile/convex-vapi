import { Agent, type Connection } from "agents";
import {
  withVoice,
  type Transcriber,
  type TranscriberSession,
  type TranscriberSessionOptions,
  type VoiceTurnContext,
} from "agents/voice";
import {
  SarvamSttSession,
  SarvamTtsProvider,
  toSarvamLanguage,
  type SarvamMode,
  type SarvamTtsModel,
} from "@convex-vapi/sarvam";
import { stepCountIs, streamText } from "ai";

import { loadAgentConfig } from "./config";
import type { CallUsage, Env, LoadedAgentConfig } from "./env";
import { evaluateTranscript, guardReplyStream } from "./guard";
import { resolveModel } from "./models";
import { postEvents, type RuntimeEvent } from "./sync";
import { buildTools } from "./tools";

const VoiceAgent = withVoice(Agent, {
  audioFormat: "pcm16",
  sampleRate: 16_000,
  historyLimit: 20,
});

/** Max assistant replies retained for duplicate suppression. */
const MAX_TRACKED_ASSISTANT_MESSAGES = 8;
/** Flush at most once a second, or immediately once this many events queue. */
const FLUSH_INTERVAL_MS = 1_000;
const MAX_BUFFERED_EVENTS = 60;
const MAX_TOOL_STEPS = 4;

type StoredTurn = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
};

type EventPayload = {
  at?: number;
  role?: "user" | "assistant";
  text?: string;
  status?: string;
  reason?: string;
  data?: string;
};

function buildSystemPrompt(config: LoadedAgentConfig): string {
  return `${config.config.systemPrompt}

You are "${config.name}". Everything you write is spoken aloud, so keep it natural and short.
Conversation rules (follow strictly):
- This conversation has already started. Never open a reply with a greeting ("नमस्ते", "नमस्कार", "hello", "hi", "hey") and never ask "how can I help" again.
- Never repeat an earlier answer and never re-introduce yourself unprompted. Answer the latest caller message directly.
- If the caller asks who you are, answer with your name ("${config.name}"). If they ask which model or company powers you, answer honestly and briefly.
- If the caller's words are unclear, ask them once to repeat. Do not restart the conversation.
- Keep replies to one or two short sentences.
- When a tool can answer the question, call it instead of guessing. After the tool returns, answer from its result and never read raw JSON aloud.

Example of a correct follow-up:
User: मेरा नाम सर्वेश है।
Assistant: बहुत अच्छा, सर्वेश जी। बताइए, मैं क्या मदद कर सकता हूँ?`;
}

/** Durable Object names are `${agentId}~${callId}`: one DO per call. */
function parseAgentName(name: string): { agentId: string; callId: string } {
  const separator = name.indexOf("~");
  if (separator === -1) {
    return { agentId: name, callId: "" };
  }
  return {
    agentId: name.slice(0, separator),
    callId: name.slice(separator + 1),
  };
}

function emptyUsage(): CallUsage {
  return {
    turns: 0,
    sttAudioMs: 0,
    ttsCharacters: 0,
    promptTokens: 0,
    completionTokens: 0,
    llmMs: 0,
    ttsMs: 0,
    firstAudioMs: 0,
  };
}

export class SarvamVoiceAgent extends VoiceAgent<Env> {
  private config: LoadedAgentConfig | null = null;
  private callId = "";
  private greeted = false;

  /** Assistant text already spoken in this call, used to suppress repeats. */
  private readonly spoken: string[] = [];

  // `tts` and `transcriber` are created per call in beforeCallStart() /
  // createTranscriber() so each agent version can choose its own voice.
  tts?: SarvamTtsProvider;

  // Event stream state. `seq` is wall-clock derived so it stays monotonic even
  // if the Durable Object is evicted and rebuilt for the same call.
  private seq = 0;
  private pending: RuntimeEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushChain: Promise<void> = Promise.resolve();

  // Per-turn instrumentation. Flushed with every batch as `callUsage`.
  private metrics: CallUsage = emptyUsage();
  private turnStartedAt = 0;
  private toolUsedThisTurn = false;

  async beforeCallStart(connection: Connection): Promise<boolean> {
    const { agentId, callId } = parseAgentName(this.name);
    const token = readToken(connection);
    if (agentId.length === 0 || callId.length === 0 || token.length === 0) {
      console.warn("voice-runtime: rejected call without a call-scoped token", {
        name: this.name,
      });
      return false;
    }

    // Reconnect to the same call: the DO is already configured for this call.
    if (this.callId === callId && this.config !== null) {
      return true;
    }

    const config = await loadAgentConfig(this.env, { callId, token });
    if (config.agentId !== agentId || config.runtime !== "cloudflare") {
      return false;
    }

    this.configure(config, callId);
    return true;
  }

  createTranscriber(_connection: Connection): Transcriber {
    const config = this.requireConfig();
    const language = toSarvamLanguage(config.config.transcriber.language);
    const mode = (config.config.transcriber.mode as SarvamMode) ?? "codemix";
    const turnTaking = config.config.turnTaking;

    return {
      createSession: (options?: TranscriberSessionOptions): TranscriberSession => {
        const session = new SarvamSttSession({
          apiKey: this.env.SARVAM_API_KEY,
          language,
          mode,
          sampleRate: 16_000,
          keyterms: config.config.transcriber.keyterms,
          debounceMs: turnTaking?.endpointingMs,
          highVadSensitivity: turnTaking?.highVadSensitivity,
          onUtterance: (text) => options?.onUtterance?.(text),
          onError: (error) => options?.onFatalError?.(error),
        });

        return {
          feed: (chunk: ArrayBuffer) => {
            // 16 kHz mono int16 = 32 bytes per millisecond.
            this.metrics.sttAudioMs += chunk.byteLength / 32;
            session.feed(chunk);
          },
          waitUntilReady: () => session.waitUntilReady(),
          close: () => session.close(),
        };
      },
    };
  }

  /**
   * Drop fragments that are noise, the agent's own TTS leaking back through the
   * microphone, or filler words. Returning null skips the turn instead of
   * letting the model answer "आप।" with a fresh greeting.
   */
  afterTranscribe(transcript: string): string | null {
    const decision = evaluateTranscript(transcript, this.spoken);
    if (decision.accept) {
      return decision.text;
    }

    this.record("transcript.rejected", {
      reason: decision.reason,
      text: transcript,
    });
    return null;
  }

  async onCallStart(connection: Connection): Promise<void> {
    const config = this.requireConfig();

    connection.send(
      JSON.stringify({
        type: "voice_call_meta",
        callId: this.callId,
        agentId: config.agentId,
        workspaceId: config.workspaceId,
        runtime: "cloudflare",
      }),
    );

    // Only greet once per call: reconnects re-send `start_call`.
    if (this.greeted) return;
    this.greeted = true;

    const firstMessage = config.config.firstMessage.trim();
    if (firstMessage.length > 0 && config.config.firstMessageMode !== "assistant-waits-for-user") {
      // `speak()` persists the assistant message; saving it here as well would
      // duplicate the greeting in history and encourage the model to re-greet.
      await this.speak(connection, firstMessage);
    }
  }

  async onTurn(transcript: string, context: VoiceTurnContext) {
    const config = this.requireConfig();
    this.requireTts();

    const startedAt = Date.now();
    this.turnStartedAt = startedAt;
    this.toolUsedThisTurn = false;
    this.metrics.turns += 1;

    const tools = buildTools(config.config.tools, {
      callId: this.callId,
      agentId: config.agentId,
      workspaceId: config.workspaceId,
      onEvent: (event) => {
        this.toolUsedThisTurn = true;
        this.record(event.phase === "called" ? "tool.called" : "tool.result", {
          at: event.at,
          text: event.name,
          data: event.data,
        });
      },
    });
    const hasTools = Object.keys(tools).length > 0;

    const result = streamText({
      model: resolveModel(config.config.model, this.env),
      system: buildSystemPrompt(config),
      messages: [
        ...context.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: "user" as const, content: transcript },
      ],
      ...(hasTools ? { tools, stopWhen: stepCountIs(MAX_TOOL_STEPS) } : {}),
      onStepEnd: (step) => {
        this.metrics.promptTokens += step.usage?.inputTokens ?? 0;
        this.metrics.completionTokens += step.usage?.outputTokens ?? 0;
        if (step.toolCalls.length > 0) {
          this.toolUsedThisTurn = true;
        }
      },
      temperature: config.config.model.temperature,
      maxOutputTokens: config.config.model.maxTokens,
      frequencyPenalty: 0.3,
      presencePenalty: 0.4,
      abortSignal: context.signal,
    });

    const guarded = guardReplyStream(result.textStream, {
      transcript,
      spoken: [...this.spoken],
      hadToolCalls: () => this.toolUsedThisTurn,
      onDrop: (rule, sentence) => {
        this.record("sentence.dropped", { reason: rule, text: sentence });
      },
    });

    return this.trackReply(guarded, startedAt);
  }

  saveMessage(role: "user" | "assistant", text: string): void {
    if (role === "assistant") {
      this.spoken.push(text);
      if (this.spoken.length > MAX_TRACKED_ASSISTANT_MESSAGES) {
        this.spoken.shift();
      }
    }

    this.record("turn.appended", { role, text });
    super.saveMessage(role, text);
  }

  async onCallEnd(): Promise<void> {
    const config = this.config;
    if (!config || this.callId.length === 0) {
      return;
    }

    try {
      const turns = this.readTurns();
      const transcript = turns
        .map((turn) => `${turn.role === "user" ? "User" : "AI"}: ${turn.text}`)
        .join("\n");

      this.record("call.ended", { status: "ended" });
      await this.flush({
        final: true,
        transcript,
        endedReason: "customer-ended-call",
        endedAt: Date.now(),
      });
    } catch (error) {
      console.error("voice-runtime: final sync failed", {
        agentId: config.agentId,
        callId: this.callId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.reset();
    }
  }

  // ---------------------------------------------------------------------------
  // Call setup
  // ---------------------------------------------------------------------------

  private configure(config: LoadedAgentConfig, callId: string): void {
    this.config = config;
    this.callId = callId;
    this.greeted = false;
    this.spoken.length = 0;
    this.pending.length = 0;
    this.metrics = emptyUsage();
    this.turnStartedAt = 0;
    this.toolUsedThisTurn = false;

    const language = toSarvamLanguage(config.config.transcriber.language);
    const ttsLanguage = language === "unknown" ? "hi-IN" : language;
    const voiceModel = config.config.voice.model ?? "bulbul:v3";

    this.tts = new SarvamTtsProvider({
      apiKey: this.env.SARVAM_API_KEY,
      language: ttsLanguage,
      speaker: config.config.voice.voiceId || "shubh",
      model: (voiceModel as SarvamTtsModel) ?? "bulbul:v3",
      sampleRate: 16_000,
      onSynthesize: (durationMs, characters) => {
        this.metrics.ttsMs += durationMs;
        this.metrics.ttsCharacters += characters;
        if (this.metrics.firstAudioMs === 0 && this.turnStartedAt > 0) {
          this.metrics.firstAudioMs = Date.now() - this.turnStartedAt;
        }
      },
    });

    this.record("call.started", { status: "in-progress" });
    void this.flush().catch(() => undefined);
  }

  private reset(): void {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.config = null;
    this.callId = "";
    this.greeted = false;
    this.spoken.length = 0;
    this.pending.length = 0;
    this.metrics = emptyUsage();
    this.turnStartedAt = 0;
    this.toolUsedThisTurn = false;
  }

  // ---------------------------------------------------------------------------
  // Event stream
  // ---------------------------------------------------------------------------

  private record(type: string, payload: EventPayload = {}): void {
    if (this.config === null) {
      return;
    }

    this.seq = Math.max(this.seq + 1, Date.now() * 1_000);
    this.pending.push({
      eventId: crypto.randomUUID(),
      seq: this.seq,
      type,
      at: payload.at ?? Date.now(),
      ...(payload.role ? { role: payload.role } : {}),
      ...(payload.text ? { text: payload.text } : {}),
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.reason ? { reason: payload.reason } : {}),
      ...(payload.data ? { data: payload.data } : {}),
    });

    if (this.pending.length >= MAX_BUFFERED_EVENTS) {
      void this.flush().catch(() => undefined);
      return;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush().catch(() => undefined);
    }, FLUSH_INTERVAL_MS);
  }

  private flush(
    options: {
      final?: boolean;
      transcript?: string;
      endedReason?: string;
      endedAt?: number;
    } = {},
  ): Promise<void> {
    const run = async (): Promise<void> => {
      const config = this.config;
      if (!config || this.callId.length === 0) {
        return;
      }
      if (this.flushTimer !== undefined) {
        clearTimeout(this.flushTimer);
        this.flushTimer = undefined;
      }
      if (this.pending.length === 0 && !options.final) {
        return;
      }

      const events = this.pending.splice(0);
      if (events.length === 0 && !options.final) {
        return;
      }

      try {
        await postEvents(this.env, {
          callId: this.callId,
          agentId: config.agentId,
          workspaceId: config.workspaceId,
          modelProvider: config.config.model.provider,
          modelName: config.config.model.model,
          events,
          usage: this.snapshotUsage(),
          ...(options.transcript ? { transcript: options.transcript } : {}),
          ...(options.endedReason ? { endedReason: options.endedReason } : {}),
          ...(options.endedAt ? { endedAt: options.endedAt } : {}),
        });
      } catch (error) {
        // Re-queue so the next flush (or the final one) retries, bounded.
        if (!options.final) {
          this.pending = [...events, ...this.pending].slice(-MAX_BUFFERED_EVENTS);
        }
        console.error("voice-runtime: event flush failed", {
          callId: this.callId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };

    const next = this.flushChain.then(run, run);
    this.flushChain = next.catch(() => undefined);
    return next;
  }

  private snapshotUsage(): CallUsage {
    return {
      turns: Math.round(this.metrics.turns),
      sttAudioMs: Math.round(this.metrics.sttAudioMs),
      ttsCharacters: Math.round(this.metrics.ttsCharacters),
      promptTokens: Math.round(this.metrics.promptTokens),
      completionTokens: Math.round(this.metrics.completionTokens),
      llmMs: Math.round(this.metrics.llmMs),
      ttsMs: Math.round(this.metrics.ttsMs),
      firstAudioMs: Math.round(this.metrics.firstAudioMs),
    };
  }

  private readTurns(): StoredTurn[] {
    try {
      const rows = this.sql<StoredTurn>`
        SELECT role, text, timestamp
        FROM cf_voice_messages
        ORDER BY id ASC
      `;
      return rows.filter((row) => row.text.trim().length > 0);
    } catch (error) {
      console.error("voice-runtime: could not read conversation", {
        callId: this.callId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async *trackReply(
    stream: AsyncGenerator<string>,
    startedAt: number,
  ): AsyncGenerator<string> {
    try {
      for await (const chunk of stream) {
        yield chunk;
      }
    } finally {
      this.metrics.llmMs += Date.now() - startedAt;
      void this.flush().catch(() => undefined);
    }
  }

  private requireConfig(): LoadedAgentConfig {
    if (!this.config) {
      throw new Error("Agent config was not loaded before the call started");
    }
    return this.config;
  }

  private requireTts(): SarvamTtsProvider {
    if (!this.tts) {
      throw new Error("Sarvam TTS was not configured for this call");
    }
    return this.tts;
  }
}

function readToken(connection: Connection): string {
  const uri = connection.uri;
  if (!uri) {
    return "";
  }
  try {
    return new URL(uri).searchParams.get("token") ?? "";
  } catch {
    return "";
  }
}
