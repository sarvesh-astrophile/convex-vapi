import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import {
  DEFAULT_MERCHANT_ID,
  dailySalesValidator,
  parseTransactionsCsv,
  parseWeeklySummaryCsv,
  salesDipOverviewValidator,
  salesTransactionValidator,
} from "./lib/salesDip";

const MAX_LIMIT = 100;
/** Transactions at or after this hour count as evening sales. */
const EVENING_START_HOUR = 17;

/**
 * Loads the bundled Sales dip CSVs into Convex. Run
 * `bun run seed:sales-dip` from `packages/backend` after deploying, or pass
 * the file contents directly:
 * `bunx convex run salesDip:seed '{"transactionsCsv":"...","weeklySummaryCsv":"..."}'`.
 */
export const seed = internalMutation({
  args: {
    transactionsCsv: v.string(),
    weeklySummaryCsv: v.string(),
  },
  returns: v.object({
    transactions: v.number(),
    summaries: v.number(),
  }),
  handler: async (ctx, args) => {
    const transactions = parseTransactionsCsv(args.transactionsCsv);
    const summaries = parseWeeklySummaryCsv(args.weeklySummaryCsv);

    for (const transaction of transactions) {
      const existing = await ctx.db
        .query("salesDipTransactions")
        .withIndex("by_transactionId", (q) => q.eq("transactionId", transaction.transactionId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, transaction);
      } else {
        await ctx.db.insert("salesDipTransactions", transaction);
      }
    }

    for (const summary of summaries) {
      const existing = await ctx.db
        .query("salesDipWeeklySummaries")
        .withIndex("by_period", (q) => q.eq("period", summary.period))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, summary);
      } else {
        await ctx.db.insert("salesDipWeeklySummaries", summary);
      }
    }

    return { transactions: transactions.length, summaries: summaries.length };
  },
});

export const getSalesDipOverview = internalQuery({
  args: {
    merchantId: v.optional(v.string()),
  },
  returns: salesDipOverviewValidator,
  handler: async (ctx, args) => {
    const merchantId = args.merchantId ?? DEFAULT_MERCHANT_ID;
    const summaries = await ctx.db.query("salesDipWeeklySummaries").take(10);

    const current = findPeriod(summaries, "current week");
    const previous = findPeriod(summaries, "previous week");
    if (!current || !previous) {
      throw new Error(
        "Sales dip demo data is not seeded. Run `bun run seed:sales-dip` from packages/backend.",
      );
    }

    return {
      merchantId,
      previousWeek: toSummary(previous),
      currentWeek: toSummary(current),
      salesDipInr: roundMoney(previous.totalSalesInr - current.totalSalesInr),
      salesDipPercent: percentDrop(previous.totalSalesInr, current.totalSalesInr),
      eveningSalesDipInr: roundMoney(previous.eveningSalesInr - current.eveningSalesInr),
      eveningSalesDipPercent: percentDrop(previous.eveningSalesInr, current.eveningSalesInr),
      transactionCountChange: current.transactionCount - previous.transactionCount,
      repeatCustomerChange: current.repeatCustomers - previous.repeatCustomers,
    };
  },
});

export const listTransactions = internalQuery({
  args: {
    merchantId: v.optional(v.string()),
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
  handler: async (ctx, args) => {
    const merchantId = args.merchantId ?? DEFAULT_MERCHANT_ID;
    const limit = clampLimit(args.limit);
    const { fromDate, toDate, paymentMode, status } = args;

    let query = ctx.db.query("salesDipTransactions").withIndex("by_merchantId_and_date", (q) => {
      const forMerchant = q.eq("merchantId", merchantId);
      if (fromDate && toDate) {
        return forMerchant.gte("date", fromDate).lte("date", toDate);
      }
      if (fromDate) return forMerchant.gte("date", fromDate);
      if (toDate) return forMerchant.lte("date", toDate);
      return forMerchant;
    });

    if (paymentMode) {
      query = query.filter((q) => q.eq(q.field("paymentMode"), paymentMode));
    }
    if (status) {
      query = query.filter((q) => q.eq(q.field("status"), status));
    }

    const transactions = await query.order("desc").take(limit);

    return {
      merchantId,
      transactions: transactions.map((transaction) => ({
        id: transaction.transactionId,
        merchantId: transaction.merchantId,
        date: transaction.date,
        time: transaction.time,
        amountInr: transaction.amountInr,
        paymentMode: transaction.paymentMode,
        status: transaction.status,
      })),
    };
  },
});

export const getDailySales = internalQuery({
  args: {
    merchantId: v.optional(v.string()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
  },
  returns: dailySalesValidator,
  handler: async (ctx, args) => {
    const merchantId = args.merchantId ?? DEFAULT_MERCHANT_ID;
    const { fromDate, toDate } = args;

    const transactions = await ctx.db
      .query("salesDipTransactions")
      .withIndex("by_merchantId_and_date", (q) => {
        const forMerchant = q.eq("merchantId", merchantId);
        if (fromDate && toDate) {
          return forMerchant.gte("date", fromDate).lte("date", toDate);
        }
        if (fromDate) return forMerchant.gte("date", fromDate);
        if (toDate) return forMerchant.lte("date", toDate);
        return forMerchant;
      })
      .order("asc")
      .take(1000);

    const byDate = new Map<
      string,
      {
        totalSalesInr: number;
        transactionCount: number;
        eveningSalesInr: number;
        eveningTransactionCount: number;
        upiSalesInr: number;
        cardSalesInr: number;
      }
    >();

    for (const transaction of transactions) {
      const day = byDate.get(transaction.date) ?? {
        totalSalesInr: 0,
        transactionCount: 0,
        eveningSalesInr: 0,
        eveningTransactionCount: 0,
        upiSalesInr: 0,
        cardSalesInr: 0,
      };

      day.totalSalesInr += transaction.amountInr;
      day.transactionCount += 1;
      if (isEvening(transaction.time)) {
        day.eveningSalesInr += transaction.amountInr;
        day.eveningTransactionCount += 1;
      }
      if (transaction.paymentMode === "UPI") day.upiSalesInr += transaction.amountInr;
      if (transaction.paymentMode === "Card") day.cardSalesInr += transaction.amountInr;

      byDate.set(transaction.date, day);
    }

    const days = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, day]) => ({
        date,
        totalSalesInr: roundMoney(day.totalSalesInr),
        transactionCount: day.transactionCount,
        eveningSalesInr: roundMoney(day.eveningSalesInr),
        eveningTransactionCount: day.eveningTransactionCount,
        upiSalesInr: roundMoney(day.upiSalesInr),
        cardSalesInr: roundMoney(day.cardSalesInr),
      }));

    return {
      days,
      totalSalesInr: roundMoney(days.reduce((total, day) => total + day.totalSalesInr, 0)),
      transactionCount: days.reduce((total, day) => total + day.transactionCount, 0),
    };
  },
});

type WeeklySummaryRow = {
  period: string;
  totalSalesInr: number;
  transactionCount: number;
  averageTransactionValueInr: number;
  eveningSalesInr: number;
  eveningTransactionCount: number;
  repeatCustomers: number;
};

function findPeriod(summaries: WeeklySummaryRow[], period: string): WeeklySummaryRow | undefined {
  return summaries.find((summary) => summary.period.trim().toLowerCase() === period);
}

function toSummary(summary: WeeklySummaryRow) {
  return {
    period: summary.period,
    totalSalesInr: summary.totalSalesInr,
    transactionCount: summary.transactionCount,
    averageTransactionValueInr: summary.averageTransactionValueInr,
    eveningSalesInr: summary.eveningSalesInr,
    eveningTransactionCount: summary.eveningTransactionCount,
    repeatCustomers: summary.repeatCustomers,
  };
}

function percentDrop(previous: number, current: number): number {
  if (previous === 0) return 0;
  return Math.round(((previous - current) / previous) * 1000) / 10;
}

function isEvening(time: string): boolean {
  const hour = Number.parseInt(time.slice(0, 2), 10);
  return Number.isFinite(hour) && hour >= EVENING_START_HOUR;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 20;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
