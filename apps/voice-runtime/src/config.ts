import type { Env, LoadedAgentConfig } from "./env";

export async function loadAgentConfig(env: Env, agentId: string): Promise<LoadedAgentConfig> {
  const url = new URL("/voice/config", env.CONVEX_SITE_URL);
  url.searchParams.set("agentId", agentId);

  const response = await fetch(url, {
    headers: { "x-voice-secret": env.VOICE_SYNC_SECRET },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Agent config request failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  return (await response.json()) as LoadedAgentConfig;
}
