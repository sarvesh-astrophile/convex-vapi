import { McpServer, tool, type McpUser, type ToolCtx } from "@convex-dev/mcp";
import type { HttpRouter } from "convex/server";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  dailyEarningsValidator,
  demandOpportunityValidator,
  earningsSummaryValidator,
  tripStatusValidator,
  tripValidator,
} from "./lib/autoDriver";

const READ_SCOPE = "auto:read";
export const PUBLIC_MCP_PATH = "/mcp/auto";

/**
 * Public MCP server: the component's OAuth layer is bypassed, so no bearer
 * token, consent page, or API key is required. The data is shared demo data,
 * not user-owned.
 */
class PublicMcpServer extends McpServer {
  override async authenticate(_ctx: ToolCtx, _request: Request): Promise<McpUser | null> {
    return {
      userId: "public",
      scopes: Object.keys(this.options.scopes ?? {}),
      connectionId: "public",
    };
  }

  /** Strip Origin so any browser-based MCP client can call the public endpoint. */
  override async handleMcp(ctx: ToolCtx, request: Request): Promise<Response> {
    const body = await request.text();
    const headers = new Headers(request.headers);
    headers.delete("Origin");
    return await super.handleMcp(ctx, new Request(request.url, { method: "POST", headers, body }));
  }
}

export const mcp: McpServer = new PublicMcpServer(components.mcp, {
  name: "auto-driver",
  title: "Auto Driver Data",
  version: "1.0.0",
  path: PUBLIC_MCP_PATH,
  instructions:
    "Read-only access to the AUTO1001 Auto driver demo export for Bengaluru, 2026-10-26 to 2026-10-31. " +
    "Fares are Indian rupees (INR). Use get_earnings_summary for a headline, list_trips to inspect individual rides, " +
    "get_daily_earnings for per-day totals, and list_demand_opportunities for suggested demand windows. " +
    "Opportunity rows are illustrative and unverified; never present them as confirmed live demand. " +
    "Dates are ISO 8601 (YYYY-MM-DD).",
  // Unused: this server has no OAuth flow. The option is required by the type.
  consentUrl: `${process.env.SITE_URL ?? "http://localhost:3001"}/`,
  scopes: {
    [READ_SCOPE]: "Read AUTO1001's trips, earnings, and demand opportunities",
  },
  tools: {
    get_earnings_summary: tool({
      description:
        "Get headline earnings and trip statistics for the AUTO1001 driver: total trips, completed trips, no-trip entries, total and average fare in INR, the covered date range, and the top pickup locations. Use this first for questions like 'how much did I earn?'.",
      args: {},
      returns: earningsSummaryValidator,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      scope: READ_SCOPE,
      handler: async (ctx) => await ctx.runQuery(internal.autoDriver.getEarningsSummary, {}),
    }),

    list_trips: tool({
      description:
        "List individual AUTO1001 trips, newest first. Filter by inclusive ISO date range (fromDate/toDate) and/or status. Returns at most `limit` trips (default 20, max 100). Each trip has an id, date, time, pickup location, fare in INR, and status.",
      args: {
        fromDate: v.optional(v.string()),
        toDate: v.optional(v.string()),
        status: v.optional(tripStatusValidator),
        limit: v.optional(v.number()),
      },
      returns: v.object({
        driverId: v.string(),
        transactions: v.array(tripValidator),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      scope: READ_SCOPE,
      handler: async (ctx, args) => await ctx.runQuery(internal.autoDriver.listTrips, args),
    }),

    get_daily_earnings: tool({
      description:
        "Get per-day earnings for AUTO1001: completed trips, no-trip entries, and earnings in INR for each date, plus the total. Dates are returned in ascending order. Use list_trips when you need individual rides instead of daily totals.",
      args: {
        fromDate: v.optional(v.string()),
        toDate: v.optional(v.string()),
      },
      returns: dailyEarningsValidator,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      scope: READ_SCOPE,
      handler: async (ctx, args) => await ctx.runQuery(internal.autoDriver.getDailyEarnings, args),
    }),

    list_demand_opportunities: tool({
      description:
        "List suggested passenger-demand windows near AUTO1001's service area. Optionally filter by ISO date and/or exact pickup location. Returns at most `limit` rows (default 20, max 100). Every row includes a verificationNote: the data is illustrative, not confirmed live demand, so present it with that caveat.",
      args: {
        date: v.optional(v.string()),
        location: v.optional(v.string()),
        limit: v.optional(v.number()),
      },
      returns: v.object({
        opportunities: v.array(demandOpportunityValidator),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      scope: READ_SCOPE,
      handler: async (ctx, args) =>
        await ctx.runQuery(internal.autoDriver.listDemandOpportunities, args),
    }),
  },
});

/**
 * Registers the public MCP endpoint. These are the only MCP routes: no
 * OAuth, authorization, token, or well-known discovery routes are exposed.
 */
export function registerPublicMcpRoutes(http: HttpRouter) {
  http.route({
    path: PUBLIC_MCP_PATH,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const response = await mcp.handleMcp(ctx as unknown as ToolCtx, request);
      return withCors(response);
    }),
  });

  http.route({
    path: PUBLIC_MCP_PATH,
    method: "GET",
    handler: httpAction(async () => {
      return new Response(publicGuide(), {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }),
  });

  http.route({
    path: PUBLIC_MCP_PATH,
    method: "OPTIONS",
    handler: httpAction(async () => {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }),
  });
}

function publicGuide(): string {
  const tools = Object.entries(mcp.options.tools)
    .map(([name, definition]) => `- ${name}: ${definition.description}`)
    .join("\n");

  return [
    "# Auto Driver Data",
    "",
    mcp.options.instructions ?? "",
    "",
    "This MCP server is public. No authentication, sign-in, or API key is required.",
    "",
    `MCP endpoint (JSON-RPC over HTTP POST): ${mcp.siteUrl}${PUBLIC_MCP_PATH}`,
    "",
    "Tools:",
    tools,
    "",
  ].join("\n");
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
    "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  };
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
