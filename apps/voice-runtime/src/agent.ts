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
import { streamText } from "ai";

import { loadAgentConfig } from "./config";
import type { Env, LoadedAgentConfig } from "./env";
import { evaluateTranscript, guardReplyStream } from "./guard";
import { resolveModel } from "./models";
import { syncCall, type SyncedTurn } from "./sync";

const VoiceAgent = withVoice(Agent, {
  audioFormat: "pcm16",
  sampleRate: 16_000,
  historyLimit: 20,
});

/**
 * PartySocket reconnects on network flaps, laptop sleep and DO restarts. The
 * client re-sends `start_call` each time, so a naive `onCallStart` would replay
 * the greeting. Resume the same call inside this window instead.
 */
const CALL_RESUME_WINDOW_MS = 5 * 60_000;
const MAX_TRACKED_ASSISTANT_MESSAGES = 8;

type StoredTurn = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
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

Example of a correct follow-up:
User: मेरा नाम सर्वेश है।
Assistant: बहुत अच्छा, सर्वेश जी। बताइए, मैं क्या मदद कर सकता हूँ?`;
}

export class SarvamVoiceAgent extends VoiceAgent<Env> {
  private config: LoadedAgentConfig | null = null;
  private callId = "";
  private startedAt = 0;
  private lastActivityAt = 0;
  private greeted = false;

  /** Assistant text already spoken in this call, used to suppress repeats. */
  private readonly spoken: string[] = [];

  // `tts` and `transcriber` are created per call in beforeCallStart() /
  // createTranscriber() so each agent version can choose its own voice.
  tts?: SarvamTtsProvider;

  async beforeCallStart(): Promise<boolean> {
    if (
      this.callId.length > 0 &&
      this.config !== null &&
      this.tts !== undefined &&
      Date.now() - this.lastActivityAt < CALL_RESUME_WINDOW_MS
    ) {
      // Reconnect of the call that is already running: keep the call id,
      // transcript and TTS provider, and skip the greeting.
      this.lastActivityAt = Date.now();
      return true;
    }

    const config = await loadAgentConfig(this.env, this.name);
    if (config.runtime !== "cloudflare") {
      return false;
    }

    this.config = config;
    this.callId = `cf_${crypto.randomUUID()}`;
    this.startedAt = Date.now();
    this.lastActivityAt = Date.now();
    this.greeted = false;
    this.spoken.length = 0;
    this.resetConversation();

    const language = toSarvamLanguage(config.config.transcriber.language);
    const ttsLanguage = language === "unknown" ? "hi-IN" : language;
    const voiceModel = config.config.voice.model ?? "bulbul:v3";

    this.tts = new SarvamTtsProvider({
      apiKey: this.env.SARVAM_API_KEY,
      language: ttsLanguage,
      speaker: config.config.voice.voiceId || "shubh",
      model: (voiceModel as SarvamTtsModel) ?? "bulbul:v3",
      sampleRate: 16_000,
    });

    return true;
  }

  createTranscriber(_connection: Connection): Transcriber {
    const config = this.requireConfig();
    const language = toSarvamLanguage(config.config.transcriber.language);
    const mode = (config.config.transcriber.mode as SarvamMode) ?? "codemix";

    return {
      createSession: (options?: TranscriberSessionOptions): TranscriberSession => {
        const session = new SarvamSttSession({
          apiKey: this.env.SARVAM_API_KEY,
          language,
          mode,
          sampleRate: 16_000,
          keyterms: config.config.transcriber.keyterms,
          onUtterance: (text) => options?.onUtterance?.(text),
          onError: (error) => options?.onFatalError?.(error),
        });

        return {
          feed: (chunk: ArrayBuffer) => session.feed(chunk),
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
      this.lastActivityAt = Date.now();
      return decision.text;
    }

    console.info("voice-runtime: ignored transcript", {
      agentId: this.name,
      reason: decision.reason,
      transcript,
    });
    return null;
  }

  async onCallStart(connection: Connection): Promise<void> {
    const config = this.requireConfig();
    this.lastActivityAt = Date.now();

    connection.send(
      JSON.stringify({
        type: "voice_call_meta",
        callId: this.callId,
        agentId: this.name,
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
    this.lastActivityAt = Date.now();

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
      temperature: config.config.model.temperature,
      maxOutputTokens: config.config.model.maxTokens,
      frequencyPenalty: 0.3,
      presencePenalty: 0.4,
      abortSignal: context.signal,
    });

    return guardReplyStream(result.textStream, {
      transcript,
      spoken: [...this.spoken],
    });
  }

  saveMessage(role: "user" | "assistant", text: string): void {
    if (role === "assistant") {
      this.spoken.push(text);
      if (this.spoken.length > MAX_TRACKED_ASSISTANT_MESSAGES) {
        this.spoken.shift();
      }
    }
    super.saveMessage(role, text);
  }

  async onCallEnd(): Promise<void> {
    const config = this.config;
    if (!config || this.callId.length === 0) {
      return;
    }

    try {
      const rows = this.sql<StoredTurn>`
        SELECT role, text, timestamp
        FROM cf_voice_messages
        ORDER BY id ASC
      `;
      const turns: SyncedTurn[] = rows
        .filter((row) => row.text.trim().length > 0)
        .map((row) => ({
          role: row.role,
          text: row.text,
          at: row.timestamp,
        }));

      const transcript = turns
        .map((turn) => `${turn.role === "user" ? "User" : "AI"}: ${turn.text}`)
        .join("\n");

      await syncCall(this.env, {
        callId: this.callId,
        agentId: this.name,
        workspaceId: config.workspaceId,
        runtime: "cloudflare",
        startedAt: this.startedAt || Date.now(),
        endedAt: Date.now(),
        endedReason: "customer-ended-call",
        modelProvider: config.config.model.provider,
        modelName: config.config.model.model,
        transcript,
        turns,
      });
    } catch (error) {
      console.error("voice-runtime: call sync failed", {
        agentId: this.name,
        callId: this.callId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.callId = "";
      this.startedAt = 0;
      this.lastActivityAt = 0;
      this.greeted = false;
      this.spoken.length = 0;
    }
  }

  /**
   * One Durable Object per agent serves every call, so the mixin's message
   * table would otherwise leak one caller's history into the next call and
   * teach the model to repeat old greetings.
   */
  private resetConversation(): void {
    if ([...this.getConnections()].length > 1) return;
    try {
      void this.sql`CREATE TABLE IF NOT EXISTS cf_voice_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )`;
      void this.sql`DELETE FROM cf_voice_messages`;
    } catch (error) {
      console.error("voice-runtime: could not reset conversation", {
        agentId: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
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
