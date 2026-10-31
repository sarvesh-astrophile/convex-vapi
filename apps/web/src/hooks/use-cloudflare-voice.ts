import type { Id } from "@convex-vapi/backend/convex/_generated/dataModel";
import { api } from "@convex-vapi/backend/convex/_generated/api";
import { useVoiceAgent } from "agents/voice/react";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ENV } from "@/env.public";
import type { ConnectionState, LiveTurn } from "@/lib/voice-types";

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

  const wantStartRef = useRef(false);
  const wasLiveRef = useRef(false);

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

  const start = useCallback(async () => {
    setLocalError(null);
    setEnded(false);
    setStarting(true);
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

  return {
    configured,
    connection,
    muted: voice.isMuted,
    error: localError ?? voice.error,
    turns,
    partial,
    callId: session?.callId ?? null,
    isLive,
    start,
    stop,
    toggleMute: voice.toggleMute,
  };
}
