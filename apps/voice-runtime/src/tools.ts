import { jsonSchema, tool, type JSONSchema7, type ToolSet } from "ai";

import type { ToolConfig } from "./env";

const TOOL_TIMEOUT_MS = 10_000;
const MAX_TOOL_RESPONSE_CHARS = 4_000;

export type ToolEvent = {
  name: string;
  phase: "called" | "result";
  at: number;
  data: string;
};

type ToolContext = {
  callId: string;
  agentId: string;
  workspaceId: string;
  onEvent: (event: ToolEvent) => void;
};

/**
 * Turns declarative agent tools into AI SDK tools.
 *
 * The contract is deliberately provider-agnostic: a tool is an HTTPS endpoint
 * that receives `{ callId, agentId, workspaceId, tool, arguments }` and returns
 * JSON. That mirrors Vapi's server-URL tools and means a workspace can add a
 * tool without redeploying the runtime.
 */
export function buildTools(tools: ToolConfig[] | undefined, context: ToolContext): ToolSet {
  const set: ToolSet = {};

  for (const config of tools ?? []) {
    if (!config.name || set[config.name]) {
      continue;
    }

    set[config.name] = tool({
      description: config.description,
      inputSchema: jsonSchema(toJsonSchema(config.parameters)),
      execute: async (input: unknown): Promise<string> => {
        const startedAt = Date.now();
        context.onEvent({
          name: config.name,
          phase: "called",
          at: startedAt,
          data: safeJson(input),
        });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "x-call-id": context.callId,
            "x-agent-id": context.agentId,
            "x-workspace-id": context.workspaceId,
          };
          if (config.secret) {
            headers.authorization = `Bearer ${config.secret}`;
          }

          const response = await fetch(config.endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({
              callId: context.callId,
              agentId: context.agentId,
              workspaceId: context.workspaceId,
              tool: config.name,
              arguments: input ?? {},
            }),
            signal: controller.signal,
          });

          const body = (await response.text()).slice(0, MAX_TOOL_RESPONSE_CHARS);
          const result = { ok: response.ok, status: response.status, body };
          context.onEvent({
            name: config.name,
            phase: "result",
            at: Date.now(),
            data: safeJson(result),
          });
          return safeJson(result);
        } catch (error) {
          const result = {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
          context.onEvent({
            name: config.name,
            phase: "result",
            at: Date.now(),
            data: safeJson(result),
          });
          return safeJson(result);
        } finally {
          clearTimeout(timer);
        }
      },
    });
  }

  return set;
}

function toJsonSchema(value: unknown): JSONSchema7 {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JSONSchema7;
  }
  return { type: "object", properties: {}, additionalProperties: true };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }
}
