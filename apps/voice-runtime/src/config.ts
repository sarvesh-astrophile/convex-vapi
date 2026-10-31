import type { Env, LoadedAgentConfig } from "./env";

export type ConfigRequest = {
  callId: string;
  token: string;
};

/**
 * Loads the published config for one call. Authenticated by the per-call
 * capability token minted in Convex, not by a shared runtime secret.
 */
export async function loadAgentConfig(
  env: Env,
  request: ConfigRequest,
): Promise<LoadedAgentConfig> {
  const url = new URL("/voice/config", env.CONVEX_SITE_URL);
  url.searchParams.set("callId", request.callId);

  // The token travels in a header so it does not land in request logs.
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "x-voice-token": request.token,
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Agent config request failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  return (await response.json()) as LoadedAgentConfig;
}
