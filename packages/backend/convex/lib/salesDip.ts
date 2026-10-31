import { v } from "convex/values";

import { parseCsv, required, requireColumns, toRecord } from "./csv";

/** The demo merchant represented by the bundled CSV export. */
export const DEFAULT_MERCHANT_ID = "MER1001";

export const salesTransactionValidator = v.object({
  id: v.string(),
  merchantId: v.string(),
  date: v.string(),
  time: v.string(),
  amountInr: v.number(),
  paymentMode: v.string(),
  status: v.string(),
});

export const weeklySummaryValidator = v.object({
  period: v.string(),
  totalSalesInr: v.number(),
  transactionCount: v.number(),
  averageTransactionValueInr: v.number(),
  eveningSalesInr: v.number(),
  eveningTransactionCount: v.number(),
  repeatCustomers: v.number(),
});

export const salesDipOverviewValidator = v.object({
  merchantId: v.string(),
  previousWeek: weeklySummaryValidator,
  currentWeek: weeklySummaryValidator,
  /** Positive means current-week sales are below the previous week. */
  salesDipInr: v.number(),
  salesDipPercent: v.number(),
  eveningSalesDipInr: v.number(),
  eveningSalesDipPercent: v.number(),
  transactionCountChange: v.number(),
  repeatCustomerChange: v.number(),
});

export const dailySalesValidator = v.object({
  days: v.array(
    v.object({
      date: v.string(),
      totalSalesInr: v.number(),
      transactionCount: v.number(),
      eveningSalesInr: v.number(),
      eveningTransactionCount: v.number(),
      upiSalesInr: v.number(),
      cardSalesInr: v.number(),
    }),
  ),
  totalSalesInr: v.number(),
  transactionCount: v.number(),
});

export type NewSalesTransaction = {
  transactionId: string;
  merchantId: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  time: string;
  amountInr: number;
  paymentMode: string;
  status: string;
};

export type NewWeeklySummary = {
  period: string;
  totalSalesInr: number;
  transactionCount: number;
  averageTransactionValueInr: number;
  eveningSalesInr: number;
  eveningTransactionCount: number;
  repeatCustomers: number;
};

export function parseTransactionsCsv(csv: string): NewSalesTransaction[] {
  const rows = parseCsv(csv);
  const header = rows.shift();
  if (!header) throw new Error("Sales dip transaction CSV is empty");
  requireColumns(header, [
    "transaction_id",
    "merchant_id",
    "date",
    "time",
    "amount_inr",
    "payment_mode",
    "status",
  ]);

  return rows.map((row, index) => {
    const record = toRecord(header, row);
    const amountInr = Number(record.amount_inr);
    if (!Number.isFinite(amountInr)) {
      throw new Error(`Row ${index + 2}: invalid amount "${record.amount_inr}"`);
    }
    return {
      transactionId: required(record, "transaction_id"),
      merchantId: required(record, "merchant_id"),
      date: required(record, "date"),
      time: required(record, "time"),
      amountInr,
      paymentMode: required(record, "payment_mode"),
      status: required(record, "status"),
    };
  });
}

export function parseWeeklySummaryCsv(csv: string): NewWeeklySummary[] {
  const rows = parseCsv(csv);
  const header = rows.shift();
  if (!header) throw new Error("Sales dip weekly summary CSV is empty");
  requireColumns(header, [
    "period",
    "total_sales_inr",
    "transaction_count",
    "average_transaction_value_inr",
    "evening_sales_inr",
    "evening_transaction_count",
    "repeat_customers",
  ]);

  return rows.map((row, index) => {
    const record = toRecord(header, row);
    const number = (key: string): number => {
      const value = Number(record[key]);
      if (!Number.isFinite(value)) {
        throw new Error(`Row ${index + 2}: invalid number in "${key}"`);
      }
      return value;
    };
    return {
      period: required(record, "period"),
      totalSalesInr: number("total_sales_inr"),
      transactionCount: number("transaction_count"),
      averageTransactionValueInr: number("average_transaction_value_inr"),
      eveningSalesInr: number("evening_sales_inr"),
      eveningTransactionCount: number("evening_transaction_count"),
      repeatCustomers: number("repeat_customers"),
    };
  });
}
