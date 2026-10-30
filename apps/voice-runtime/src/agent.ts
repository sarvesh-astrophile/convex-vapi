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
import { resolveModel } from "./models";
import { syncCall, type SyncedTurn } from "./sync";

const VoiceAgent = withVoice(Agent, {
  audioFormat: "pcm16",
  sampleRate: 16_000,
  historyLimit: 20,
});

type StoredTurn = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
};

function buildSystemPrompt(config: LoadedAgentConfig): string {
  return `${config.config.systemPrompt}

You are "${config.name}".
Conversation rules:
- The first assistant message already greeted the caller. Do not greet again.
- Do not introduce yourself unless the caller asks who they are speaking to. If asked, say you are "${config.name}".
- Use prior turns and the caller's name when relevant.
- Do not repeat a previous answer verbatim; answer the latest user message.
- Keep replies to one or two short spoken sentences.`;
}

export class SarvamVoiceAgent extends VoiceAgent<Env> {
  private config: LoadedAgentConfig | null = null;
  private callId = "";
  private startedAt = 0;

  // `tts` and `transcriber` are created per call in beforeCallStart() /
  // createTranscriber() so each agent version can choose its own voice.
  tts?: SarvamTtsProvider;

  async beforeCallStart(): Promise<boolean> {
    const config = await loadAgentConfig(this.env, this.name);
    if (config.runtime !== "cloudflare") {
      return false;
    }

    this.config = config;
    this.callId = `cf_${crypto.randomUUID()}`;
    this.startedAt = Date.now();

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

  async onCallStart(connection: Connection): Promise<void> {
    const config = this.requireConfig();

    connection.send(
      JSON.stringify({
        type: "voice_call_meta",
        callId: this.callId,
        agentId: this.name,
        workspaceId: config.workspaceId,
        runtime: "cloudflare",
      }),
    );

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
      abortSignal: context.signal,
    });

    return result.stream;
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
