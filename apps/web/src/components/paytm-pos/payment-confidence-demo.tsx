import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ENV } from "@/env.public";
import { PAYTM_HELP_ASSISTANT_ID, PAYTM_HELP_ASSISTANT_NAME } from "@/lib/vapi-assistants";

import { DURATION, SCENARIOS, SCREEN_COPY, SCRIPTS, STAGES, STATUS_NAMES } from "./demo-data";
import type { Scenario, ScreenState } from "./demo-data";
import { IphoneCallDialog } from "./iphone-call-dialog";

import "./styles.css";

const QR_COUNT = 8;
const HELP_ASSISTANT_ID = ENV.VITE_VAPI_PAYTM_ASSISTANT_ID || PAYTM_HELP_ASSISTANT_ID;

const FLOW_STEP: Record<ScreenState, number> = {
  amount: 0,
  active: 1,
  expired: 2,
  checking: 3,
  pending: 3,
  unpaid: 4,
  paid: 4,
  duplicate: 4,
  refund: 4,
};

const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];

function money(amount: string) {
  return Number(amount || "0").toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function fallbackCopy(value: string) {
  const area = document.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand("copy");
    return true;
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mini-row">
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

function ScreenActions({
  primary,
  onPrimary,
  secondary,
  onSecondary,
}: {
  primary: string;
  onPrimary: () => void;
  secondary?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="s-actions">
      <button type="button" className="s-btn" onClick={onPrimary}>
        {primary}
      </button>
      {secondary ? (
        <button type="button" className="s-btn outline" onClick={onSecondary}>
          {secondary}
        </button>
      ) : null}
    </div>
  );
}

export default function PaymentConfidenceDemo() {
  const [state, setState] = useState<ScreenState>("amount");
  const [scenario, setScenario] = useState<Scenario>("paid");
  const [amountInput, setAmountInput] = useState("1280");
  const [order, setOrder] = useState("POS-DEMO-001");
  const [qrIndex, setQrIndex] = useState(0);
  const [seconds, setSeconds] = useState(DURATION);
  const [refundRef, setRefundRef] = useState("");
  const [phone, setPhone] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const toastTimer = useRef<number | undefined>(undefined);
  const checkTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2900);
  }, []);

  useEffect(() => {
    return () => {
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(checkTimer.current);
    };
  }, []);

  const goTo = useCallback((next: ScreenState) => {
    window.clearTimeout(checkTimer.current);
    setState(next);
    if (next === "active") setSeconds(DURATION);
  }, []);

  useEffect(() => {
    if (state !== "active") return;
    const id = window.setInterval(() => {
      setSeconds((value) => (value > 0 ? value - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (state === "active" && seconds === 0) {
      setState("expired");
      showToast("QR expired. Verify the payment before retrying.");
    }
  }, [seconds, state, showToast]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen]);

  const reset = useCallback(() => {
    window.clearTimeout(checkTimer.current);
    setState("amount");
    setSeconds(DURATION);
    setAmountInput("1280");
    setQrIndex(0);
    setOrder("POS-DEMO-001");
    setRefundRef("");
    setPhone("");
    setModalOpen(false);
    showToast("Ready for a new demo sale");
  }, [showToast]);

  const generateQr = useCallback(() => {
    if (!Number(amountInput) || Number(amountInput) < 1) {
      showToast("Enter an amount greater than ₹0");
      return;
    }
    setOrder(`POS-DEMO-${100 + Math.floor(Math.random() * 900)}`);
    setQrIndex((value) => (value + 1) % QR_COUNT);
    goTo("active");
  }, [amountInput, goTo, showToast]);

  const retry = useCallback(() => {
    setQrIndex((value) => (value + 1) % QR_COUNT);
    goTo("active");
  }, [goTo]);

  const expire = useCallback(() => {
    if (state !== "active") return;
    goTo("expired");
    showToast("QR time ended. The payment result is still unknown.");
  }, [goTo, showToast, state]);

  const verify = useCallback(() => {
    if (!["active", "expired", "pending", "unpaid"].includes(state)) return;
    window.clearTimeout(checkTimer.current);
    setState("checking");
    checkTimer.current = window.setTimeout(() => {
      setState(scenario);
    }, 1200);
  }, [scenario, state]);

  const changeAmount = (digit: string) => {
    if (state !== "amount") return;
    if (digit === "C") {
      setAmountInput("");
    } else if (digit === "⌫") {
      setAmountInput((value) => value.slice(0, -1));
    } else {
      setAmountInput((value) => (value + digit).replace(/^0+(?=\d)/, "").slice(0, 7));
    }
  };

  const generateRefund = () => {
    if (state !== "duplicate") return;
    setRefundRef(`RF-DEMO-${Math.floor(100000 + Math.random() * 900000)}`);
    goTo("refund");
    showToast("Demo refund initiated. No real refund occurred.");
  };

  const copyText = useCallback(
    (value: string) => {
      const copied = () => showToast("Copied to clipboard");
      const failed = () => showToast("Copy is not available in this browser");

      if (navigator.clipboard && window.isSecureContext) {
        void navigator.clipboard
          .writeText(value)
          .then(copied)
          .catch(() => {
            if (fallbackCopy(value)) copied();
            else failed();
          });
      } else if (fallbackCopy(value)) {
        copied();
      } else {
        failed();
      }
    },
    [showToast],
  );

  const currentScript =
    SCRIPTS[state] + (state === "refund" && refundRef ? ` Reference: ${refundRef}.` : "");

  const callCustomer = () => {
    const number = phone.replace(/[\s()-]/g, "");
    if (!/^\+?\d{10,15}$/.test(number)) {
      showToast("Enter a valid customer phone number in the right panel");
      return;
    }
    window.location.href = `tel:${number}`;
  };

  const qrMarkup = (expired: boolean) => (
    <>
      <div className="qr-wrap">
        <div className={expired ? "qr-frame expired" : "qr-frame"}>
          <img
            alt="Demo-only QR code, not a valid payment QR"
            src={`/paytm-pos/qr-${qrIndex + 1}.png`}
          />
          {expired ? (
            <div className="qr-block">
              <b>⌛</b>
              QR expired
            </div>
          ) : null}
        </div>
      </div>
      <div className="fake-qr">DEMO QR · NOT A REAL PAYMENT CODE</div>
    </>
  );

  let screenBody: ReactNode;
  let screenBottom: ReactNode;

  switch (state) {
    case "amount":
      screenBody = (
        <>
          <div className="amount-box">
            <div className="amount-caption">Amount to collect · INR</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 25, fontWeight: 900, color: "#102b65" }}>₹</span>
              <input
                id="screen-amount"
                className="amount-field"
                type="text"
                inputMode="numeric"
                aria-label="Amount in rupees"
                maxLength={7}
                placeholder="0"
                value={amountInput}
                onChange={(event) =>
                  setAmountInput(event.target.value.replace(/\D/g, "").slice(0, 7))
                }
              />
            </div>
            <div className="amount-help">One order · One payment</div>
          </div>
          <div className="keypad">
            {KEYPAD.map((digit) => (
              <button key={digit} type="button" className="key" onClick={() => changeAmount(digit)}>
                {digit}
              </button>
            ))}
          </div>
          <div className="tiny-caution">
            If the code expires, we’ll verify the first attempt before retrying.
          </div>
        </>
      );
      screenBottom = <ScreenActions primary="Generate payment QR →" onPrimary={generateQr} />;
      break;

    case "active":
      screenBody = (
        <>
          <div className="center">
            <div className="pay-amount">{money(amountInput)}</div>
            <span className="pill blue">● QR is active</span>
          </div>
          {qrMarkup(false)}
          <div className="countdown">
            <span>QR expires in</span>
            <strong>{seconds}s</strong>
          </div>
          <div className="timer-track">
            <div className="timer-progress" style={{ width: `${(seconds / DURATION) * 100}%` }} />
          </div>
          <div className="tiny-caution">
            Pay once. If the timer ends during payment, we’ll check its status.
          </div>
        </>
      );
      screenBottom = (
        <ScreenActions
          primary="Customer says paid · Check"
          onPrimary={verify}
          secondary="Need help? Talk to assistant"
          onSecondary={() => setModalOpen(true)}
        />
      );
      break;

    case "expired":
      screenBody = (
        <>
          <span className="pill orange">◷ PAYMENT NOT YET CONFIRMED</span>
          {qrMarkup(true)}
          <div className="status-hero orange">
            <div className="status-title">Payment may still arrive</div>
            <div className="status-desc">
              The QR timer expired, but the customer could have paid just before it ended. Check the
              original attempt first.
            </div>
          </div>
          <div className="tiny-caution">
            <b>Tell your customer:</b> “Please don’t pay again yet.”
          </div>
        </>
      );
      screenBottom = (
        <ScreenActions
          primary="Check original payment →"
          onPrimary={verify}
          secondary="Contact customer"
          onSecondary={() => setModalOpen(true)}
        />
      );
      break;

    case "checking":
      screenBody = (
        <>
          <div className="center" style={{ paddingTop: 35 }}>
            <div className="spin" />
            <div className="status-title">Confirming payment status</div>
            <div className="status-desc">
              This can take a moment. We will not request a second payment while the result is
              uncertain.
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Row label="Order">{order}</Row>
            <Row label="Amount">{money(amountInput)}</Row>
          </div>
        </>
      );
      screenBottom = (
        <button type="button" className="s-btn muted" disabled>
          Checking with payment provider…
        </button>
      );
      break;

    case "pending":
      screenBody = (
        <>
          <span className="pill orange">◷ PAYMENT PENDING</span>
          <div className="status-hero blue">
            <div className="status-icon">◷</div>
            <div className="status-title">We haven’t got a final result</div>
            <div className="status-desc">
              The customer’s bank may still be processing this attempt. Keep the order open and
              recheck before generating another QR.
            </div>
          </div>
          <Row label="Original order">{order}</Row>
          <Row label="Amount">{money(amountInput)}</Row>
          <div className="tiny-caution">
            Ask customer to check their UPI app and wait for confirmation. Do not promise a refund
            yet.
          </div>
        </>
      );
      screenBottom = (
        <ScreenActions
          primary="Recheck payment status"
          onPrimary={verify}
          secondary="Contact customer"
          onSecondary={() => setModalOpen(true)}
        />
      );
      break;

    case "unpaid":
      screenBody = (
        <>
          <span className="pill blue">○ NO PAYMENT CONFIRMED</span>
          <div className="status-hero blue">
            <div className="status-icon">▣</div>
            <div className="status-title">No successful payment found</div>
            <div className="status-desc">
              Our simulated final status says no payment was received. Offer a fresh QR for the same
              order.
            </div>
          </div>
          <Row label="Original order">{order}</Row>
          <Row label="Amount">{money(amountInput)}</Row>
          <div className="tiny-caution">
            Before retrying, ask if the customer sees a debit. If they do, investigate the
            discrepancy instead.
          </div>
        </>
      );
      screenBottom = (
        <ScreenActions
          primary="Generate fresh QR →"
          onPrimary={retry}
          secondary="Contact customer"
          onSecondary={() => setModalOpen(true)}
        />
      );
      break;

    case "paid":
      screenBody = (
        <>
          <div className="center" style={{ paddingTop: 22 }}>
            <div
              className="status-icon"
              style={{
                display: "grid",
                width: 64,
                height: 64,
                margin: "0 auto",
                placeItems: "center",
                borderRadius: "50%",
                background: "#e7f9ee",
                color: "#079b62",
                fontSize: 40,
              }}
            >
              ✓
            </div>
            <div className="receipt-amount">{money(amountInput)}</div>
            <span className="pill green">PAYMENT SUCCESSFUL</span>
          </div>
          <div className="status-hero green">
            <div className="status-title">No second payment needed</div>
            <div className="status-desc">
              The first transaction succeeded. You can hand over the goods and close the sale.
            </div>
          </div>
          <Row label="Order">{order}</Row>
          <Row label="Confirmation">DEMO-SUCCESS</Row>
        </>
      );
      screenBottom = (
        <ScreenActions
          primary="Complete sale"
          onPrimary={reset}
          secondary="Customer needs help?"
          onSecondary={() => setModalOpen(true)}
        />
      );
      break;

    case "duplicate":
      screenBody = (
        <>
          <span className="pill red">! DUPLICATE PAYMENT VERIFIED</span>
          <div className="status-hero red">
            <div className="status-icon">↻</div>
            <div className="status-title">Two payments for one order</div>
            <div className="status-desc">
              Both payments are shown as successful in this simulation. Keep one payment for the
              sale and refund the extra amount.
            </div>
          </div>
          <Row label="Sale amount">{money(amountInput)}</Row>
          <Row label="Extra payment to refund">{money(amountInput)}</Row>
          <div className="tiny-caution">
            Only initiate a refund after matching the extra payment and confirming it has not
            already been reversed.
          </div>
        </>
      );
      screenBottom = (
        <ScreenActions
          primary="Initiate extra-payment refund"
          onPrimary={generateRefund}
          secondary="Contact customer"
          onSecondary={() => setModalOpen(true)}
        />
      );
      break;

    case "refund":
      screenBody = (
        <>
          <div className="center" style={{ paddingTop: 16 }}>
            <div className="status-icon" style={{ color: "#15905e", fontSize: 40 }}>
              ✓
            </div>
            <div className="status-title">Extra payment refund requested</div>
            <div className="receipt-amount">{money(amountInput)}</div>
            <span className="pill green">REFUND INITIATED · DEMO</span>
          </div>
          <div className="status-hero green">
            <div className="status-desc">
              Share the refund reference. Actual completion time depends on the payment provider and
              the customer’s bank.
            </div>
          </div>
          <Row label="Refund reference">{refundRef}</Row>
          <Row label="Status">Initiated, not completed</Row>
        </>
      );
      screenBottom = (
        <ScreenActions
          primary="Contact customer with reference"
          onPrimary={() => setModalOpen(true)}
          secondary="Finish sale"
          onSecondary={reset}
        />
      );
      break;
  }

  const currentStep = FLOW_STEP[state];
  const screenCopy = SCREEN_COPY[state];

  return (
    <div className="paytm-pos h-full overflow-y-auto">
      <header className="header">
        <div className="header-brand">
          <div className="logo">P</div>
          <div>
            <div className="header-title">Paytm POS · Payment confidence</div>
            <div className="header-sub">A better experience when a dynamic QR expires</div>
          </div>
        </div>
        <div className="demo-tag">
          <b />
          INTERACTIVE CONCEPT · NO REAL PAYMENTS
        </div>
      </header>

      <main className="workspace">
        <aside className="panel left-panel">
          <div className="eyebrow">The customer journey</div>
          <h2>Keep the sale. Remove uncertainty.</h2>
          <p>
            QR expiry is a timer event, <strong>not</strong> proof that money was never debited.
            This flow makes it safe for shoppers to stay.
          </p>
          <ol className="flow-list">
            {STAGES.map(([title, detail], index) => {
              const status = currentStep === index ? "active" : index < currentStep ? "done" : "";
              return (
                <li key={title} className={["flow-step", status].filter(Boolean).join(" ")}>
                  <div className="flow-num">{index < currentStep ? "✓" : index + 1}</div>
                  <div>
                    <div className="flow-label">{title}</div>
                    <div className="flow-detail">{detail}</div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="problem-note">
            <strong>Core UX principle</strong>
            <p>
              Never show “Payment failed” based on QR expiry alone. First verify the original
              attempt, then decide whether a new payment is needed.
            </p>
          </div>
        </aside>

        <section className="device-column" aria-label="Interactive payment terminal">
          <div className="device-caption">Try the flow on the touchscreen</div>
          <div className="device-shadow">
            <div className="device">
              <img
                className="device-graphic"
                alt="Front view of a Paytm-inspired payment terminal"
                src="/paytm-pos/terminal.svg"
              />
              <div className="screen">
                <div className="statusbar">
                  <span>▮▮ &nbsp; Demo merchant</span>
                  <span>◕ ▰ &nbsp; 12:30</span>
                </div>
                <div className="screen-content">
                  <div className="s-top">
                    <div className="s-overline">PAYTM · ALL-IN-ONE</div>
                    <div className="s-heading">{screenCopy.title}</div>
                    <div className="s-sub">{screenCopy.sub}</div>
                  </div>
                  <div className="s-body" aria-live="polite">
                    {screenBody}
                  </div>
                  <div className="s-bottom">{screenBottom}</div>
                </div>
                <div className="screen-nav" aria-label="Terminal navigation">
                  <div className="nav-item active">
                    <span className="glyph">⌂</span>Home
                  </div>
                  <div className="nav-item">
                    <span className="glyph">◷</span>History
                  </div>
                  <div className="nav-item">
                    <span className="glyph">▤</span>Reports
                  </div>
                  <div className="nav-item">
                    <span className="glyph">☷</span>More
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="help-caption">
            All controls work in-browser. QR codes link only to an example.com demo URL and cannot
            collect money.
          </div>
        </section>

        <aside className="panel right-panel">
          <div className="eyebrow">Merchant test controls</div>
          <h2>Simulate what happened</h2>
          <p>
            Choose a payment outcome, let the QR expire, and see what the cashier should do next.
          </p>
          <div className="card-sep" />
          <div className="small-h">Payment result to simulate</div>
          <div className="scenario-grid">
            {SCENARIOS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={scenario === item.id ? "scenario selected" : "scenario"}
                aria-pressed={scenario === item.id}
                onClick={() => {
                  setScenario(item.id);
                  showToast(`Demo result set: ${STATUS_NAMES[item.id]}`);
                }}
              >
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </button>
            ))}
          </div>
          <label className="input-label" htmlFor="customer-phone">
            Customer phone (optional, for call demo)
          </label>
          <input
            id="customer-phone"
            className="field"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="e.g. +91 98765 43210"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <div className="tool-actions">
            <button
              type="button"
              className="tool-button"
              disabled={state !== "active"}
              onClick={expire}
            >
              Expire QR now
            </button>
            <button
              type="button"
              className="tool-button primary"
              disabled={!["active", "expired", "pending", "unpaid"].includes(state)}
              onClick={verify}
            >
              Check status
            </button>
            <button
              type="button"
              className="tool-button"
              disabled={!["pending", "expired", "unpaid", "checking"].includes(state)}
              onClick={() => goTo("paid")}
            >
              Resolve as paid
            </button>
            <button
              type="button"
              className="tool-button"
              disabled={!["pending", "expired", "checking"].includes(state)}
              onClick={() => goTo("unpaid")}
            >
              Resolve as unpaid
            </button>
            <button
              type="button"
              className="tool-button"
              disabled={!["paid", "pending", "expired", "checking"].includes(state)}
              onClick={() => goTo("duplicate")}
            >
              Detect duplicate
            </button>
            <button type="button" className="tool-button" onClick={reset}>
              ↻ Reset sale
            </button>
          </div>
          <div className="card-sep" />
          <div className="small-h">
            Live state <span className="live-flag">{STATUS_NAMES[state]}</span>
          </div>
          <div className="small-h" style={{ marginTop: 14 }}>
            What to tell the customer
          </div>
          <div className="script">{currentScript}</div>
          <button type="button" className="inline-link" onClick={() => copyText(currentScript)}>
            Copy reassurance script ↗
          </button>
          <div className="right-note">
            Status must come from a trusted payment provider / backend. A refund should be initiated
            only after duplicate debit is confirmed.
          </div>
          <div className="disclaimer">
            UX simulation only. No payment gateway, real customer calling, transaction verification
            or real refund processing is connected.
          </div>
        </aside>
      </main>

      {modalOpen ? (
        <IphoneCallDialog
          assistantId={HELP_ASSISTANT_ID}
          callerName={PAYTM_HELP_ASSISTANT_NAME}
          script={currentScript}
          onClose={() => setModalOpen(false)}
          onCopyScript={() => copyText(currentScript)}
          onCallCustomer={callCustomer}
        />
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
