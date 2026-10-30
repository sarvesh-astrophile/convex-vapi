import type { Env } from "./env";

export type SyncedTurn = {
  role: "user" | "assistant";
  text: string;
  at: number;
};

export type CallSyncPayload = {
  callId: string;
  agentId: string;
  workspaceId: string;
  runtime: "cloudflare";
  startedAt: number;
  endedAt: number;
  endedReason: string;
  modelProvider: string;
  modelName: string;
  transcript: string;
  turns: SyncedTurn[];
};

export async function syncCall(env: Env, payload: CallSyncPayload): Promise<void> {
  const response = await fetch(new URL("/webhooks/voice", env.CONVEX_SITE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-voice-secret": env.VOICE_SYNC_SECRET,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Call sync failed (${response.status}): ${detail.slice(0, 300)}`);
  }
}
