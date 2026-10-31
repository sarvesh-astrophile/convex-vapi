import { McpServer, tool } from "@convex-dev/mcp";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import {
  dailySalesValidator,
  salesDipOverviewValidator,
  salesTransactionValidator,
} from "./lib/salesDip";

const READ_SCOPE = "sales:read";

/**
 * Read-only MCP surface over the bundled Sales dip demo export.
 *
 * The data is not user-owned: every signed-in user connected with a
 * `sales:read` connection sees the same MER1001 export. No tool takes a
 * user ID.
 */
export const salesDipMcp: McpServer = new McpServer(components.mcp, {
  name: "sales-dip",
  title: "Sales Dip Data",
  version: "1.0.0",
  path: "/mcp/sales-dip",
  instructions:
    "Read-only access to the MER1001 merchant demo export for 2026-10-20 to 2026-10-29. " +
    "Amounts are Indian rupees (INR). Use get_sales_dip_overview first for the week-over-week " +
    "headline (positive salesDipInr means sales fell), list_transactions to inspect individual " +
    "payments, and get_daily_sales for per-day totals and evening/UPI/Card splits. " +
    "This is bundled demo data, not live merchant data. Dates are ISO 8601 (YYYY-MM-DD).",
  consentUrl: `${process.env.SITE_URL ?? "http://localhost:3001"}/connect?server=sales-dip`,
  scopes: {
    [READ_SCOPE]: "Read MER1001's transactions, weekly totals, and sales dip analysis",
  },
  tools: {
    get_sales_dip_overview: tool({
      description:
        "Compare MER1001's current week with the previous week: total sales, transaction counts, evening sales, and repeat customers. Positive salesDipInr and salesDipPercent mean sales are down; negative means sales grew. Use this first for questions like 'what changed this week?'.",
      args: {},
      returns: salesDipOverviewValidator,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      scope: READ_SCOPE,
      handler: async (ctx) => await ctx.runQuery(internal.salesDip.getSalesDipOverview, {}),
    }),

    list_transactions: tool({
      description:
        "List individual MER1001 transactions, newest first. Filter by inclusive ISO date range (fromDate/toDate), payment mode (e.g. UPI or Card), and/or status. Returns at most `limit` transactions (default 20, max 100). Each transaction has an id, merchant id, date, time, amount in INR, payment mode, and status.",
      args: {
        fromDate: v.optional(v.string()),
        toDate: v.optional(v.string()),
        paymentMode: v.optional(v.string()),
        status: v.optional(v.string()),
        limit: v.optional(v.number()),
      },
      returns: v.object({
        merchantId: v.string(),
        transactions: v.array(salesTransactionValidator),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      scope: READ_SCOPE,
      handler: async (ctx, args) => await ctx.runQuery(internal.salesDip.listTransactions, args),
    }),

    get_daily_sales: tool({
      description:
        "Get per-day sales for MER1001: total sales in INR, transaction count, evening sales (from 17:00), evening transaction count, and UPI/Card splits for each date, plus range totals. Dates are returned in ascending order. Use list_transactions when you need individual payments instead of daily totals.",
      args: {
        fromDate: v.optional(v.string()),
        toDate: v.optional(v.string()),
      },
      returns: dailySalesValidator,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      scope: READ_SCOPE,
      handler: async (ctx, args) => await ctx.runQuery(internal.salesDip.getDailySales, args),
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
} = salesDipMcp.api({
  // With Convex Better Auth, `subject` is the Better Auth user id.
  getUserId: async (ctx) => (await ctx.auth.getUserIdentity())?.subject ?? null,
});

/** Operator/CLI helper; only callable with deploy credentials. */
export const { createApiKeyForUser } = salesDipMcp.internalApi();
