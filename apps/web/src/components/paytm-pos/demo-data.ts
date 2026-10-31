export const DURATION = 25;

export type ScreenState =
  | "amount"
  | "active"
  | "expired"
  | "checking"
  | "pending"
  | "unpaid"
  | "paid"
  | "duplicate"
  | "refund";

export type Scenario = "paid" | "pending" | "unpaid" | "duplicate";

export const STATUS_NAMES: Record<ScreenState, string> = {
  amount: "New sale",
  active: "QR active",
  expired: "QR expired",
  checking: "Checking payment",
  pending: "Payment pending",
  unpaid: "Not received",
  paid: "Payment confirmed",
  duplicate: "Duplicate detected",
  refund: "Refund initiated",
};

export const SCREEN_COPY: Record<ScreenState, { title: string; sub: string }> = {
  amount: {
    title: "New sale",
    sub: "Enter the amount you want to collect.",
  },
  active: {
    title: "Scan to pay",
    sub: "Customer can scan with any UPI app.",
  },
  expired: {
    title: "QR time ended",
    sub: "Your order is still open.",
  },
  checking: {
    title: "Checking payment",
    sub: "Verifying the original transaction.",
  },
  pending: {
    title: "Still processing",
    sub: "Do not charge the customer twice.",
  },
  unpaid: {
    title: "Ready to retry",
    sub: "Original attempt checked.",
  },
  paid: {
    title: "Payment confirmed",
    sub: "Customer can take their items.",
  },
  duplicate: {
    title: "Duplicate detected",
    sub: "Customer reassurance needed.",
  },
  refund: {
    title: "Refund initiated",
    sub: "Give the customer a reference.",
  },
};

export const STAGES: ReadonlyArray<readonly [title: string, detail: string]> = [
  ["Enter amount", "Start a sale and create one order."],
  ["Display QR", "Show an expiring code for that order."],
  ["QR expires", "Keep payment status “unknown”."],
  ["Verify payment", "Ask the payment system before retrying."],
  ["Reassure & resolve", "Confirm, retry, or refund only if verified."],
];

export const SCRIPTS: Record<ScreenState, string> = {
  amount: "We’ll show a secure QR code for your order. Please complete one payment.",
  active:
    "You can scan this code once. If it expires while you’re paying, we’ll check your transaction before asking you to pay again.",
  expired:
    "The QR time has ended, but that does not mean your payment failed. Please don’t pay again yet; I’m checking the status.",
  checking:
    "I’m verifying whether your first payment reached us. Please don’t make a second payment until we confirm.",
  pending:
    "Your bank may still be processing the payment. We’ll recheck it before requesting any further payment.",
  unpaid:
    "We have checked and cannot see a successful payment for this order. We can try a fresh QR. Please also check your bank app.",
  paid: "Your payment is confirmed. Thank you! You do not need to pay again.",
  duplicate:
    "We’ve identified two payments for one order. We’ll initiate a refund for the extra payment and provide the reference.",
  refund:
    "We verified a duplicate payment and initiated a refund for the extra amount. Here is your refund reference. Timing depends on the provider and your bank.",
};

export const SCENARIOS: ReadonlyArray<{
  id: Scenario;
  label: string;
  hint: string;
}> = [
  { id: "paid", label: "✓ Paid", hint: "Late confirmation" },
  { id: "pending", label: "◷ Still pending", hint: "Bank is processing" },
  { id: "unpaid", label: "○ Not received", hint: "Safe to retry" },
  { id: "duplicate", label: "↻ Paid twice", hint: "Refund the extra" },
];
