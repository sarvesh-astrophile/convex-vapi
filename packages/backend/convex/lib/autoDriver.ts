import { v } from "convex/values";

import { parseCsv, required, requireColumns, toRecord } from "./csv";

/** The demo driver represented by the bundled CSV export. */
export const AUTO_DRIVER_ID = "AUTO1001";

export const tripStatusValidator = v.union(v.literal("Success"), v.literal("No trip"));

export const tripValidator = v.object({
  id: v.string(),
  date: v.string(),
  time: v.string(),
  pickupLocation: v.string(),
  fareInr: v.number(),
  status: tripStatusValidator,
});

export const earningsSummaryValidator = v.object({
  driverId: v.string(),
  fromDate: v.union(v.string(), v.null()),
  toDate: v.union(v.string(), v.null()),
  totalTrips: v.number(),
  completedTrips: v.number(),
  noTripCount: v.number(),
  earningsInr: v.number(),
  averageFareInr: v.number(),
  topPickupLocations: v.array(
    v.object({
      location: v.string(),
      trips: v.number(),
    }),
  ),
});

export const dailyEarningsValidator = v.object({
  days: v.array(
    v.object({
      date: v.string(),
      completedTrips: v.number(),
      noTrips: v.number(),
      earningsInr: v.number(),
    }),
  ),
  totalEarningsInr: v.number(),
});

export const demandOpportunityValidator = v.object({
  id: v.string(),
  location: v.string(),
  context: v.string(),
  date: v.string(),
  expectedTime: v.string(),
  type: v.string(),
  verificationNote: v.string(),
});

export type NewTrip = {
  transactionId: string;
  driverId: string;
  date: string;
  time: string;
  pickupLocation: string;
  fareInr: number;
  status: "Success" | "No trip";
};

export type NewDemandOpportunity = {
  opportunityId: string;
  location: string;
  eventOrContext: string;
  date: string;
  expectedTime: string;
  opportunityType: string;
  verificationNote: string;
};

export function parseTransactionsCsv(csv: string): NewTrip[] {
  const rows = parseCsv(csv);
  const header = rows.shift();
  if (!header) throw new Error("Transaction CSV is empty");
  requireColumns(header, [
    "transaction_id",
    "driver_id",
    "date",
    "time",
    "pickup_location",
    "fare_inr",
    "status",
  ]);

  return rows.map((row, index) => {
    const record = toRecord(header, row);
    const status = record.status;
    if (status !== "Success" && status !== "No trip") {
      throw new Error(`Row ${index + 2}: unknown status "${status}"`);
    }
    const fareInr = Number(record.fare_inr);
    if (!Number.isFinite(fareInr)) {
      throw new Error(`Row ${index + 2}: invalid fare "${record.fare_inr}"`);
    }
    return {
      transactionId: required(record, "transaction_id"),
      driverId: required(record, "driver_id"),
      date: required(record, "date"),
      time: required(record, "time"),
      pickupLocation: required(record, "pickup_location"),
      fareInr,
      status,
    };
  });
}

export function parseOpportunitiesCsv(csv: string): NewDemandOpportunity[] {
  const rows = parseCsv(csv);
  const header = rows.shift();
  if (!header) throw new Error("Opportunity CSV is empty");
  requireColumns(header, [
    "opportunity_id",
    "location",
    "event_or_context",
    "date",
    "expected_time",
    "opportunity_type",
    "verification_note",
  ]);

  return rows.map((row) => {
    const record = toRecord(header, row);
    return {
      opportunityId: required(record, "opportunity_id"),
      location: required(record, "location"),
      eventOrContext: required(record, "event_or_context"),
      date: required(record, "date"),
      expectedTime: required(record, "expected_time"),
      opportunityType: required(record, "opportunity_type"),
      verificationNote: required(record, "verification_note"),
    };
  });
}
