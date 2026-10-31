import type { Id } from "@convex-vapi/backend/convex/_generated/dataModel";
import { api } from "@convex-vapi/backend/convex/_generated/api";
import { useVoiceAgent } from "agents/voice/react";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ENV } from "@/env.public";
import type { ConnectionState, LiveTurn, PipelineLatency, TurnLatency } from "@/lib/voice-types";

/** Turns kept for the latency strip. Enough to see a trend, not a table. */
const MAX_LATENCY_HISTORY = 12;

export type CloudflareVoiceOptions = {
  agentId: string;
  workspaceId?: Id<"workspaces">;
  enabled: boolean;
};

function runtimeHost(): string {
  if (!ENV.VITE_VOICE_RUNTIME_URL) return "";
  try {
    return new URL(ENV.VITE_VOICE_RUNTIME_URL).host;
  } catch {
    return "";
  }
}

type CallSession = {
  callId: string;
  token: string;
};

/**
 * Cloudflare `agents/voice` transport.
 *
 * A call is minted in Convex first (`calls.start`), which creates the call row
 * and a per-call capability token. The Durable Object name is
 * `${agentId}~${callId}`, so every call gets its own DO and its own history —
 * no shared state between concurrent callers. The token travels in the
 * WebSocket query string and is the only way the runtime can read the config.
 */
export function useCloudflareVoice({ agentId, workspaceId, enabled }: CloudflareVoiceOptions) {
  const host = runtimeHost();
  const configured = enabled && agentId.length > 0 && host.length > 0;

  const [session, setSession] = useState<CallSession | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [ended, setEnded] = useState(false);
  const [latencyHistory, setLatencyHistory] = useState<TurnLatency[]>([]);
  const [connectMs, setConnectMs] = useState<number | null>(null);

  const wantStartRef = useRef(false);
  const wasLiveRef = useRef(false);
  const lastTurnIdRef = useRef<string | null>(null);
  const requestedAtRef = useRef<number | null>(null);

  const mintCall = useMutation(api.calls.start);

  const voice = useVoiceAgent({
    agent: "SarvamVoiceAgent",
    name: session ? `${agentId}~${session.callId}` : agentId || "default",
    host,
    enabled: configured && session !== null,
    query: session ? { token: session.token } : undefined,
    preferredFormat: "pcm16",
  });

  const isLive =
    voice.status === "listening" || voice.status === "thinking" || voice.status === "speaking";

  // `voice.startCall` is recreated on every render; refs keep the effects from
  // re-running (and re-starting calls) on unrelated state changes.
  const startCallRef = useRef(voice.startCall);
  startCallRef.current = voice.startCall;
  const endCallRef = useRef(voice.endCall);
  endCallRef.current = voice.endCall;

  useEffect(() => {
    if (!session || !wantStartRef.current || !voice.connected) {
      return;
    }
    wantStartRef.current = false;
    void startCallRef
      .current()
      .catch((error: unknown) => {
        setLocalError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setStarting(false);
      });
  }, [session, voice.connected]);

  useEffect(() => {
    if (!wantStartRef.current || !voice.error) {
      return;
    }
    wantStartRef.current = false;
    setStarting(false);
    setLocalError(voice.error);
  }, [voice.error]);

  useEffect(() => {
    if (isLive) {
      wasLiveRef.current = true;
      return;
    }
    if (!wasLiveRef.current) {
      return;
    }
    wasLiveRef.current = false;
    setEnded(true);
  }, [isLive]);

  // The SDK reports one terminal summary per turn; append it once per turnId.
  const turnMetrics = voice.turnMetrics;
  const pipelineMetrics = voice.metrics;

  // Press Start -> call active (mint, socket, token exchange, config load).
  useEffect(() => {
    if (voice.status === "idle" || requestedAtRef.current === null) {
      return;
    }
    setConnectMs(Date.now() - requestedAtRef.current);
    requestedAtRef.current = null;
  }, [voice.status]);

  useEffect(() => {
    if (!turnMetrics || lastTurnIdRef.current === turnMetrics.turnId) {
      return;
    }
    lastTurnIdRef.current = turnMetrics.turnId;
    setLatencyHistory((history) => [
      ...history.slice(-(MAX_LATENCY_HISTORY - 1)),
      {
        turnId: turnMetrics.turnId,
        outcome: turnMetrics.outcome,
        at: Date.now(),
        replyMs: turnMetrics.finalInputToFirstAudioMs ?? pipelineMetrics?.first_audio_ms,
        sttFinalMs: turnMetrics.speechStartToFinalMs,
        modelFirstTextMs: turnMetrics.modelToFirstTextMs,
        ttsFirstAudioMs: turnMetrics.ttsToFirstAudioMs,
        turnTotalMs: turnMetrics.turnTotalMs,
      },
    ]);
  }, [turnMetrics, pipelineMetrics]);

  const start = useCallback(async () => {
    setLocalError(null);
    setEnded(false);
    setStarting(true);
    setLatencyHistory([]);
    lastTurnIdRef.current = null;
    requestedAtRef.current = Date.now();
    setConnectMs(null);
    wantStartRef.current = true;

    try {
      const minted = await mintCall({
        agentId: agentId as Id<"agents">,
        workspaceId,
      });
      setSession({ callId: minted.callId, token: minted.token });
    } catch (error) {
      wantStartRef.current = false;
      setStarting(false);
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  }, [agentId, mintCall, workspaceId]);

  const stop = useCallback(() => {
    wantStartRef.current = false;
    endCallRef.current();
    setStarting(false);
    setEnded(true);
  }, []);

  const connection: ConnectionState =
    localError || voice.error
      ? "error"
      : isLive
        ? "active"
        : ended
          ? "ended"
          : starting || (session !== null && !voice.connected)
            ? "connecting"
            : "idle";

  const turns: LiveTurn[] = voice.transcript.map((message, index) => ({
    id: `${index}-${message.timestamp}`,
    role: message.role,
    text: message.text,
  }));

  const partial: LiveTurn | null = voice.interimTranscript
    ? { id: "partial", role: "user", text: voice.interimTranscript }
    : null;

  const latestLatency = latencyHistory.at(-1) ?? null;
  const latency: PipelineLatency | null = pipelineMetrics
    ? {
        llmMs: pipelineMetrics.llm_ms,
        ttsMs: pipelineMetrics.tts_ms,
        firstAudioMs: pipelineMetrics.first_audio_ms,
        totalMs: pipelineMetrics.total_ms,
      }
    : null;

  return {
    configured,
    connection,
    muted: voice.isMuted,
    error: localError ?? voice.error,
    turns,
    partial,
    callId: session?.callId ?? null,
    isLive,
    runtimeUrl: ENV.VITE_VOICE_RUNTIME_URL,
    latestLatency,
    latency,
    latencyHistory,
    connectMs,
    start,
    stop,
    toggleMute: voice.toggleMute,
  };
}
