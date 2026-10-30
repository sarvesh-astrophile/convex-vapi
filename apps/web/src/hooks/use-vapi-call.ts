import type { Id } from "@convex-vapi/backend/convex/_generated/dataModel";
import type VapiClient from "@vapi-ai/web";
import { api } from "@convex-vapi/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionState = "idle" | "connecting" | "active" | "ending" | "ended" | "error";

export type LiveTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type VapiMessage = {
  type?: unknown;
  role?: unknown;
  transcript?: unknown;
  transcriptType?: unknown;
  status?: unknown;
};

type VapiConstructor = new (publicKey: string) => VapiClient;

/**
 * `@vapi-ai/web` is CommonJS (`exports.default = Vapi`). Vite wraps that in an
 * ESM module whose `default` is the whole CommonJS exports object, so the
 * constructor can live at `module.default` or `module.default.default`
 * depending on the bundler/dev mode. Unwrap until we find the class.
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; error?: unknown };
    if (typeof candidate.message === "string") {
      return candidate.message;
    }
    if (typeof candidate.error === "string") {
      return candidate.error;
    }
  }
  return "The call failed. Check the browser console for details.";
}

/**
 * Owns one Vapi Web SDK client for the page. Audio travels over Vapi's WebRTC
 * transport; Convex receives call state reactively from our own tables.
 */
export function useVapiCall(
  publicKey: string,
  assistantId: string,
  workspaceId?: Id<"workspaces">,
) {
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [partial, setPartial] = useState<LiveTurn | null>(null);
  const [callId, setCallId] = useState<string | null>(null);

  const clientRef = useRef<VapiClient | null>(null);
  const startedRef = useRef(false);
  const callIdRef = useRef<string | null>(null);
  const claimedRef = useRef<string | null>(null);
  const turnCounterRef = useRef(0);

  const register = useMutation(api.calls.register);
  const markEnded = useMutation(api.calls.markEnded);
  const registerRef = useRef(register);
  const markEndedRef = useRef(markEnded);
  const assistantIdRef = useRef(assistantId);
  const workspaceIdRef = useRef(workspaceId);

  useEffect(() => {
    registerRef.current = register;
    markEndedRef.current = markEnded;
    assistantIdRef.current = assistantId;
    workspaceIdRef.current = workspaceId;
  }, [assistantId, markEnded, register, workspaceId]);

  const configured = publicKey.length > 0 && assistantId.length > 0;

  useEffect(() => {
    if (!configured) {
      return;
    }

    let cancelled = false;

    async function initialize() {
      const Vapi = resolveVapiConstructor(await import("@vapi-ai/web"));
      if (cancelled) {
        return;
      }

      const client = new Vapi(publicKey);

      const claim = (vapiCallId: string) => {
        if (claimedRef.current === vapiCallId) {
          return;
        }
        claimedRef.current = vapiCallId;
        callIdRef.current = vapiCallId;
        setCallId(vapiCallId);
        void registerRef
          .current({
            callId: vapiCallId,
            assistantId: assistantIdRef.current,
            workspaceId: workspaceIdRef.current,
          })
          .catch((claimError: unknown) => {
            setError(errorMessage(claimError));
          });
      };

      client.on("call-start", () => {
        startedRef.current = true;
        setConnection("active");
        setError(null);
      });

      client.on("call-start-success", (event) => {
        if (event.callId) {
          claim(event.callId);
        }
      });

      client.on("call-end", () => {
        startedRef.current = false;
        setConnection("ended");
        setMuted(false);
        setPartial(null);

        const endedCallId = callIdRef.current;
        if (endedCallId) {
          void markEndedRef.current({ callId: endedCallId }).catch(() => {
            // The webhook will still reconcile the final state.
          });
        }
      });

      client.on("message", (message: VapiMessage) => {
        if (!message || typeof message !== "object") {
          return;
        }

        if (message.type === "status-update" && typeof message.status === "string") {
          if (message.status === "ended") {
            setConnection("ended");
          }
          return;
        }

        if (message.type !== "transcript") {
          return;
        }

        const role = message.role === "assistant" ? "assistant" : "user";
        if (typeof message.transcript !== "string" || message.transcript.trim() === "") {
          return;
        }

        const text = message.transcript.trim();
        const isFinal = message.transcriptType === "final";

        if (!isFinal) {
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
        // The SDK also emits non-fatal audio-processing errors (for example a
        // Krisp init failure) while the call keeps running, so only leave the
        // live state if the call never started.
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
      setError("Set VITE_VAPI_PUBLIC_KEY and VITE_VAPI_ASSISTANT_ID to start a call.");
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
    callIdRef.current = null;
    claimedRef.current = null;
    setConnection("connecting");
    console.info("[vapi] starting web call", {
      assistantId,
      publicKeyPrefix: publicKey.slice(0, 8),
    });

    try {
      const call = await client.start(assistantId, { maxDurationSeconds: 600 });
      if (call?.id) {
        claimedRef.current = call.id;
        callIdRef.current = call.id;
        setCallId(call.id);
        await registerRef
          .current({ callId: call.id, assistantId, workspaceId: workspaceIdRef.current })
          .catch((claimError: unknown) => {
            setError(errorMessage(claimError));
          });
      }
      startedRef.current = true;
      setConnection("active");
    } catch (startError) {
      setError(errorMessage(startError));
      setConnection("error");
      startedRef.current = false;
    }
  }, [assistantId, configured, publicKey]);

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
