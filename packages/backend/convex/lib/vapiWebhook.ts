/**
 * Pure parsing helpers for Vapi's server-message webhook payloads.
 *
 * Vapi wraps every server message as `{ message: ... }`. Only the fields this
 * app persists are extracted; everything else stays in the raw payload stored
 * in `webhookEvents` for auditing.
 */

export type VapiTurn = {
  role: "user" | "assistant";
  text: string;
  at: number;
};

export type ParsedVapiWebhook = {
  type: string;
  callId?: string;
  assistantId?: string;
  userId?: string;
  status?: string;
  endedReason?: string;
  transcript?: string;
  summary?: string;
  recordingUrl?: string;
  cost?: number;
  startedAt?: number;
  endedAt?: number;
  turns: VapiTurn[];
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function textFromContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        const object = asObject(part);
        return object ? asString(object.text) : undefined;
      })
      .filter((part): part is string => typeof part === "string");
    return parts.join("\n").trim() || undefined;
  }
  return undefined;
}

function parseTurns(value: unknown, startedAt: number | undefined): VapiTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const turns: VapiTurn[] = [];
  for (const item of value) {
    const message = asObject(item);
    if (!message) {
      continue;
    }

    const role = asString(message.role);
    if (role !== "user" && role !== "assistant" && role !== "bot") {
      continue;
    }

    const text =
      asString(message.message) ?? asString(message.content) ?? textFromContent(message.content);
    if (!text) {
      continue;
    }

    const seconds = asNumber(message.secondsFromStart);
    const at =
      startedAt !== undefined && seconds !== undefined
        ? startedAt + Math.round(seconds * 1000)
        : (startedAt ?? 0);

    turns.push({
      role: role === "user" ? "user" : "assistant",
      text,
      at,
    });
  }

  return turns;
}

export function parseVapiWebhook(rawBody: string): ParsedVapiWebhook | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const root = asObject(parsed);
  const message = asObject(root?.message);
  if (!message) {
    return null;
  }

  const type = asString(message.type);
  if (!type) {
    return null;
  }

  const call = asObject(message.call);
  const artifact = asObject(message.artifact);
  const recording = asObject(artifact?.recording);
  const mono = asObject(recording?.mono);
  const analysis = asObject(message.analysis);
  const metadata = asObject(call?.metadata);

  const startedAt = asTimestamp(message.startedAt) ?? asTimestamp(call?.startedAt);
  const endedAt = asTimestamp(message.endedAt) ?? asTimestamp(call?.endedAt);

  return {
    type,
    callId: asString(call?.id),
    assistantId: asString(call?.assistantId),
    userId: asString(metadata?.userId),
    status: asString(message.status) ?? asString(call?.status),
    endedReason: asString(message.endedReason) ?? asString(call?.endedReason),
    transcript: asString(message.transcript) ?? asString(artifact?.transcript),
    summary: asString(message.summary) ?? asString(analysis?.summary),
    recordingUrl:
      asString(artifact?.recordingUrl) ??
      asString(recording?.combinedUrl) ??
      asString(mono?.combinedUrl),
    cost: asNumber(message.cost) ?? asNumber(call?.cost),
    startedAt,
    endedAt,
    turns: parseTurns(artifact?.messages, startedAt),
  };
}
