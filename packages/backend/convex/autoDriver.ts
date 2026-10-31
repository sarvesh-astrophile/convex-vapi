import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import {
  AUTO_DRIVER_ID,
  dailyEarningsValidator,
  demandOpportunityValidator,
  earningsSummaryValidator,
  parseOpportunitiesCsv,
  parseTransactionsCsv,
  tripStatusValidator,
  tripValidator,
} from "./lib/autoDriver";

const MAX_LIMIT = 100;

/**
 * Loads the bundled CSVs into Convex. Run `bun run seed:auto-driver` from
 * `packages/backend` after deploying, or pass the file contents directly:
 * `bunx convex run autoDriver:seed '{"transactionsCsv":"...","opportunitiesCsv":"..."}'`.
 */
export const seed = internalMutation({
  args: {
    transactionsCsv: v.string(),
    opportunitiesCsv: v.string(),
  },
  returns: v.object({
    transactions: v.number(),
    opportunities: v.number(),
  }),
  handler: async (ctx, args) => {
    const trips = parseTransactionsCsv(args.transactionsCsv);
    const opportunities = parseOpportunitiesCsv(args.opportunitiesCsv);

    for (const trip of trips) {
      const existing = await ctx.db
        .query("autoDriverTransactions")
        .withIndex("by_transactionId", (q) => q.eq("transactionId", trip.transactionId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, trip);
      } else {
        await ctx.db.insert("autoDriverTransactions", trip);
      }
    }

    for (const opportunity of opportunities) {
      const existing = await ctx.db
        .query("autoDriverOpportunities")
        .withIndex("by_opportunityId", (q) => q.eq("opportunityId", opportunity.opportunityId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, opportunity);
      } else {
        await ctx.db.insert("autoDriverOpportunities", opportunity);
      }
    }

    return { transactions: trips.length, opportunities: opportunities.length };
  },
});

export const getEarningsSummary = internalQuery({
  args: {
    driverId: v.optional(v.string()),
  },
  returns: earningsSummaryValidator,
  handler: async (ctx, args) => {
    const driverId = args.driverId ?? AUTO_DRIVER_ID;
    const trips = await ctx.db
      .query("autoDriverTransactions")
      .withIndex("by_driverId_and_date", (q) => q.eq("driverId", driverId))
      .take(1000);

    let completedTrips = 0;
    let noTripCount = 0;
    let earningsInr = 0;
    let fromDate: string | null = null;
    let toDate: string | null = null;
    const pickupCounts = new Map<string, number>();

    for (const trip of trips) {
      if (trip.status === "Success") {
        completedTrips += 1;
        earningsInr += trip.fareInr;
        pickupCounts.set(trip.pickupLocation, (pickupCounts.get(trip.pickupLocation) ?? 0) + 1);
      } else {
        noTripCount += 1;
      }
      if (fromDate === null || trip.date < fromDate) fromDate = trip.date;
      if (toDate === null || trip.date > toDate) toDate = trip.date;
    }

    return {
      driverId,
      fromDate,
      toDate,
      totalTrips: trips.length,
      completedTrips,
      noTripCount,
      earningsInr: roundMoney(earningsInr),
      averageFareInr: completedTrips === 0 ? 0 : roundMoney(earningsInr / completedTrips),
      topPickupLocations: [...pickupCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([location, count]) => ({ location, trips: count })),
    };
  },
});

export const listTrips = internalQuery({
  args: {
    driverId: v.optional(v.string()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    status: v.optional(tripStatusValidator),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    driverId: v.string(),
    transactions: v.array(tripValidator),
  }),
  handler: async (ctx, args) => {
    const driverId = args.driverId ?? AUTO_DRIVER_ID;
    const limit = clampLimit(args.limit);
    const { fromDate, toDate, status } = args;

    const query = ctx.db.query("autoDriverTransactions").withIndex("by_driverId_and_date", (q) => {
      const forDriver = q.eq("driverId", driverId);
      if (fromDate && toDate) {
        return forDriver.gte("date", fromDate).lte("date", toDate);
      }
      if (fromDate) return forDriver.gte("date", fromDate);
      if (toDate) return forDriver.lte("date", toDate);
      return forDriver;
    });

    const filtered = status ? query.filter((q) => q.eq(q.field("status"), status)) : query;

    const trips = await filtered.order("desc").take(limit);

    return {
      driverId,
      transactions: trips.map((trip) => ({
        id: trip.transactionId,
        date: trip.date,
        time: trip.time,
        pickupLocation: trip.pickupLocation,
        fareInr: trip.fareInr,
        status: trip.status,
      })),
    };
  },
});

export const getDailyEarnings = internalQuery({
  args: {
    driverId: v.optional(v.string()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
  },
  returns: dailyEarningsValidator,
  handler: async (ctx, args) => {
    const driverId = args.driverId ?? AUTO_DRIVER_ID;
    const { fromDate, toDate } = args;

    const trips = await ctx.db
      .query("autoDriverTransactions")
      .withIndex("by_driverId_and_date", (q) => {
        const forDriver = q.eq("driverId", driverId);
        if (fromDate && toDate) {
          return forDriver.gte("date", fromDate).lte("date", toDate);
        }
        if (fromDate) return forDriver.gte("date", fromDate);
        if (toDate) return forDriver.lte("date", toDate);
        return forDriver;
      })
      .order("asc")
      .take(1000);

    const byDate = new Map<
      string,
      { completedTrips: number; noTrips: number; earningsInr: number }
    >();

    for (const trip of trips) {
      const day = byDate.get(trip.date) ?? {
        completedTrips: 0,
        noTrips: 0,
        earningsInr: 0,
      };
      if (trip.status === "Success") {
        day.completedTrips += 1;
        day.earningsInr += trip.fareInr;
      } else {
        day.noTrips += 1;
      }
      byDate.set(trip.date, day);
    }

    const days = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, day]) => ({
        date,
        completedTrips: day.completedTrips,
        noTrips: day.noTrips,
        earningsInr: roundMoney(day.earningsInr),
      }));

    return {
      days,
      totalEarningsInr: roundMoney(days.reduce((total, day) => total + day.earningsInr, 0)),
    };
  },
});

export const listDemandOpportunities = internalQuery({
  args: {
    date: v.optional(v.string()),
    location: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    opportunities: v.array(demandOpportunityValidator),
  }),
  handler: async (ctx, args) => {
    const limit = clampLimit(args.limit);
    const { date, location } = args;

    const query = location
      ? ctx.db.query("autoDriverOpportunities").withIndex("by_location_and_date", (q) => {
          const forLocation = q.eq("location", location);
          return date ? forLocation.eq("date", date) : forLocation;
        })
      : ctx.db
          .query("autoDriverOpportunities")
          .withIndex("by_date", (q) => (date ? q.eq("date", date) : q));

    const opportunities = await query.order("asc").take(limit);

    return {
      opportunities: opportunities.map((opportunity) => ({
        id: opportunity.opportunityId,
        location: opportunity.location,
        context: opportunity.eventOrContext,
        date: opportunity.date,
        expectedTime: opportunity.expectedTime,
        type: opportunity.opportunityType,
        verificationNote: opportunity.verificationNote,
      })),
    };
  },
});

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 20;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
