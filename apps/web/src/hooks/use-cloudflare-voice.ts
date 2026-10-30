import type { Id } from "@convex-vapi/backend/convex/_generated/dataModel";
import { api } from "@convex-vapi/backend/convex/_generated/api";
import { useVoiceAgent } from "agents/voice/react";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ENV } from "@/env.public";
import type { ConnectionState, LiveTurn } from "@/lib/voice-types";

type VoiceMeta = {
  type?: unknown;
  callId?: unknown;
  agentId?: unknown;
  workspaceId?: unknown;
};

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

/**
 * Cloudflare `agents/voice` transport. The Durable Object sends
 * `voice_call_meta` once the call starts; we claim that call in Convex and
 * sync the transcript when the call ends.
 */
export function useCloudflareVoice({ agentId, workspaceId, enabled }: CloudflareVoiceOptions) {
  const host = runtimeHost();
  const configured = enabled && agentId.length > 0 && host.length > 0;

  const voice = useVoiceAgent({
    agent: "SarvamVoiceAgent",
    name: agentId || "default",
    host,
    enabled: configured,
    preferredFormat: "pcm16",
  });

  const register = useMutation(api.calls.register);
  const markEnded = useMutation(api.calls.markEnded);
  const [callId, setCallId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const handledCallRef = useRef<string | null>(null);
  const wasLiveRef = useRef(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);

  const isLive =
    voice.status === "listening" || voice.status === "thinking" || voice.status === "speaking";

  useEffect(() => {
    const meta = voice.lastCustomMessage as VoiceMeta | null;
    if (!meta || meta.type !== "voice_call_meta" || typeof meta.callId !== "string") {
      return;
    }
    if (handledCallRef.current === meta.callId) return;
    handledCallRef.current = meta.callId;
    setCallId(meta.callId);

    void register({
      callId: meta.callId,
      runtime: "cloudflare",
      agentId: agentId as Id<"agents">,
      workspaceId,
    }).catch((error: unknown) => {
      setLocalError(error instanceof Error ? error.message : String(error));
    });
  }, [agentId, register, voice.lastCustomMessage, workspaceId]);

  useEffect(() => {
    if (isLive) {
      wasLiveRef.current = true;
      return;
    }
    if (!wasLiveRef.current || !handledCallRef.current) return;
    wasLiveRef.current = false;
    setEnded(true);
    void markEnded({ callId: handledCallRef.current }).catch(() => {
      // The call sync will reconcile the final state.
    });
  }, [isLive, markEnded]);

  const start = useCallback(async () => {
    setLocalError(null);
    setEnded(false);
    setStarted(true);
    await voice.startCall();
  }, [voice]);

  const stop = useCallback(() => {
    voice.endCall();
    setStarted(false);
    setEnded(true);
    if (handledCallRef.current) {
      void markEnded({ callId: handledCallRef.current }).catch(() => {});
    }
  }, [markEnded, voice]);

  const connection: ConnectionState =
    localError || voice.error
      ? "error"
      : isLive
        ? "active"
        : ended
          ? "ended"
          : started
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

  return {
    configured,
    ready: voice.connected,
    connection,
    muted: voice.isMuted,
    error: localError ?? voice.error,
    turns,
    partial,
    callId,
    isLive,
    start,
    stop,
    toggleMute: voice.toggleMute,
  };
}
