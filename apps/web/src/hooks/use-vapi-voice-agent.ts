import type VapiClient from "@vapi-ai/web";
import { useCallback, useEffect, useRef, useState } from "react";

export type VapiConnectionState = "idle" | "connecting" | "active" | "ending" | "ended" | "error";

export type VapiTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type VapiConstructor = new (publicKey: string) => VapiClient;

type UseVapiVoiceAgentOptions = {
  publicKey: string;
  assistantId: string;
  autoStart?: boolean;
};

/**
 * The web SDK is CommonJS, so Vite can expose the constructor at
 * `module.default` or `module.default.default` depending on the bundle.
 */
function resolveVapiConstructor(module: unknown): VapiConstructor {
  let candidate: unknown = module;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof candidate === "function") {
      return candidate as VapiConstructor;
    }
    if (typeof candidate === "object" && candidate !== null) {
      const record = candidate as Record<string, unknown>;
      const next = record.default ?? record.Vapi ?? record.vapi;
      if (next === undefined || next === candidate) {
        break;
      }
      candidate = next;
      continue;
    }
    break;
  }
  throw new Error("Unable to load the Vapi Web SDK.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (isRecord(error)) {
    const candidate = error as { message?: unknown; error?: unknown };
    if (typeof candidate.message === "string") {
      return candidate.message;
    }
    if (typeof candidate.error === "string") {
      return candidate.error;
    }
  }
  return "The voice call failed. Check microphone permissions and try again.";
}

/**
 * Owns one Vapi Web SDK client for an on-screen browser voice agent. Audio
 * travels over Vapi's WebRTC transport; no Convex call record is required for
 * short-lived help sessions.
 */
export function useVapiVoiceAgent({
  publicKey,
  assistantId,
  autoStart = false,
}: UseVapiVoiceAgentOptions) {
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<VapiConnectionState>("idle");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<VapiTurn[]>([]);
  const [partial, setPartial] = useState<VapiTurn | null>(null);
  const [callId, setCallId] = useState<string | null>(null);

  const clientRef = useRef<VapiClient | null>(null);
  const startedRef = useRef(false);
  const turnCounterRef = useRef(0);
  const autoStartedRef = useRef(false);

  const configured = publicKey.length > 0 && assistantId.length > 0;

  useEffect(() => {
    if (!configured) {
      setReady(false);
      return;
    }

    let cancelled = false;

    async function initialize() {
      const Vapi = resolveVapiConstructor(await import("@vapi-ai/web"));
      if (cancelled) {
        return;
      }

      const client = new Vapi(publicKey);

      client.on("call-start", () => {
        startedRef.current = true;
        setConnection("active");
        setError(null);
      });

      client.on("call-start-success", (event) => {
        if (event.callId) {
          setCallId(event.callId);
        }
      });

      client.on("call-end", () => {
        startedRef.current = false;
        setConnection("ended");
        setMuted(false);
        setPartial(null);
      });

      client.on("message", (message: unknown) => {
        if (!isRecord(message)) {
          return;
        }

        if (message.type === "status-update") {
          if (message.status === "ended") {
            setConnection("ended");
          }
          return;
        }

        if (message.type !== "transcript") {
          return;
        }

        const role = message.role === "assistant" ? "assistant" : "user";
        const text = typeof message.transcript === "string" ? message.transcript.trim() : "";
        if (!text) {
          return;
        }

        if (message.transcriptType !== "final") {
          setPartial({ id: `partial-${role}`, role, text });
          return;
        }

        setPartial((current) => (current?.role === role ? null : current));
        setTurns((current) => {
          const last = current[current.length - 1];
          if (last && last.role === role && last.text === text) {
            return current;
          }
          turnCounterRef.current += 1;
          return [...current, { id: `turn-${turnCounterRef.current}`, role, text }];
        });
      });

      client.on("error", (clientError) => {
        setError(errorMessage(clientError));
        // Krisp/audio-processing errors can fire while a call keeps running,
        // so only leave the live state when the call never started.
        if (!startedRef.current) {
          setConnection("error");
          setMuted(false);
        }
      });

      clientRef.current = client;
      setReady(true);
    }

    void initialize().catch((initError: unknown) => {
      if (!cancelled) {
        setError(errorMessage(initError));
        setConnection("error");
        setReady(false);
      }
    });

    return () => {
      cancelled = true;
      const client = clientRef.current;
      clientRef.current = null;
      if (client) {
        client.removeAllListeners();
        if (startedRef.current) {
          void client.stop().catch(() => {
            // Releasing the microphone is best-effort during unmount.
          });
        }
      }
      startedRef.current = false;
    };
  }, [configured, publicKey]);

  const start = useCallback(async () => {
    if (!configured) {
      setError(
        publicKey.length === 0
          ? "Set VITE_VAPI_PUBLIC_KEY in apps/web/.env to enable voice help."
          : "No Vapi assistant is configured for voice help.",
      );
      setConnection("error");
      return;
    }

    const client = clientRef.current;
    if (!client) {
      setError("The voice client is still loading. Try again in a moment.");
      return;
    }

    setError(null);
    setTurns([]);
    setPartial(null);
    setCallId(null);
    setConnection("connecting");

    try {
      const call = await client.start(assistantId);
      if (call?.id) {
        setCallId(call.id);
      }
      startedRef.current = true;
      setConnection("active");
    } catch (startError) {
      setError(errorMessage(startError));
      setConnection("error");
      startedRef.current = false;
    }
  }, [assistantId, configured, publicKey.length]);

  const stop = useCallback(async () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }

    setConnection("ending");
    try {
      await client.stop();
    } catch (stopError) {
      setError(errorMessage(stopError));
    } finally {
      startedRef.current = false;
      setMuted(false);
      setConnection("ended");
    }
  }, []);

  const toggleMute = useCallback(() => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    const nextMuted = !client.isMuted();
    client.setMuted(nextMuted);
    setMuted(nextMuted);
  }, []);

  useEffect(() => {
    if (!autoStart || !ready || !configured || autoStartedRef.current) {
      return;
    }
    autoStartedRef.current = true;
    void start();
  }, [autoStart, configured, ready, start]);

  return {
    configured,
    ready,
    connection,
    muted,
    error,
    turns,
    partial,
    callId,
    start,
    stop,
    toggleMute,
    isLive: connection === "connecting" || connection === "active" || connection === "ending",
  };
}
