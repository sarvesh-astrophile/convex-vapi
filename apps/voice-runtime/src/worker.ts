import { routeAgentRequest } from "agents";

import { SarvamVoiceAgent } from "./agent";
import type { Env } from "./env";

export { SarvamVoiceAgent };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json({ ok: true });
    }

    const routed = await routeAgentRequest(request, env);
    if (routed) {
      return routed;
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
