const VAPI_BASE_URL = "https://api.vapi.ai";

export type VapiAssistantPayload = {
  name: string;
  firstMessage: string;
  firstMessageMode?: string;
  model: {
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
    messages: Array<{ role: "system"; content: string }>;
  };
  voice: {
    provider: string;
    voiceId: string;
  };
  transcriber: {
    provider: string;
    model: string;
    language: string;
  };
  server: {
    url: string;
    secret: string;
  };
  serverMessages: string[];
};

export type VapiAssistantResponse = {
  id: string;
  name?: string;
};

async function vapiRequest(
  apiKey: string,
  path: string,
  init: RequestInit,
): Promise<VapiAssistantResponse> {
  const response = await fetch(`${VAPI_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    // Vapi error bodies can be long; keep the message bounded and never log
    // the request headers.
    throw new Error(`Vapi ${response.status}: ${body.slice(0, 500)}`);
  }

  return (await response.json()) as VapiAssistantResponse;
}

export async function createVapiAssistant(
  apiKey: string,
  payload: VapiAssistantPayload,
): Promise<VapiAssistantResponse> {
  return await vapiRequest(apiKey, "/assistant", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateVapiAssistant(
  apiKey: string,
  assistantId: string,
  payload: VapiAssistantPayload,
): Promise<VapiAssistantResponse> {
  return await vapiRequest(apiKey, `/assistant/${encodeURIComponent(assistantId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteVapiAssistant(
  apiKey: string,
  assistantId: string,
): Promise<VapiAssistantResponse> {
  return await vapiRequest(apiKey, `/assistant/${encodeURIComponent(assistantId)}`, {
    method: "DELETE",
  });
}
