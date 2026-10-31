import { McpServer, tool } from "@convex-dev/mcp";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import {
  dailyEarningsValidator,
  demandOpportunityValidator,
  earningsSummaryValidator,
  tripStatusValidator,
  tripValidator,
} from "./lib/autoDriver";

const READ_SCOPE = "auto:read";

/**
 * Read-only MCP surface over the bundled Auto driver demo data.
 *
 * The data is not user-owned: every signed-in user with an `auto:read`
 * connection sees the same AUTO1001 export. No tool takes a user ID.
 */
export const mcp: McpServer = new McpServer(components.mcp, {
  name: "auto-driver",
  title: "Auto Driver Data",
  version: "1.0.0",
  path: "/mcp/auto",
  instructions:
    "Read-only access to the AUTO1001 Auto driver demo export for Bengaluru, 2026-10-26 to 2026-10-31. " +
    "Fares are Indian rupees (INR). Use get_earnings_summary for a headline, list_trips to inspect individual rides, " +
    "get_daily_earnings for per-day totals, and list_demand_opportunities for suggested demand windows. " +
    "Opportunity rows are illustrative and unverified; never present them as confirmed live demand. " +
    "Dates are ISO 8601 (YYYY-MM-DD).",
  consentUrl:
    process.env.MCP_CONSENT_URL ?? `${process.env.SITE_URL ?? "http://localhost:3001"}/connect`,
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

export const {
  getAuthRequest,
  authorize,
  listConnections,
  revokeConnection,
  createApiKey,
  findAuthRequest,
} = mcp.api({
  // With Convex Better Auth, `subject` is the Better Auth user id.
  getUserId: async (ctx) => (await ctx.auth.getUserIdentity())?.subject ?? null,
});

/** Operator/CLI helper; only callable with deploy credentials. */
export const { createApiKeyForUser } = mcp.internalApi();
