import { ArrowRight } from "lucide-react";

import { ENV } from "@/env.public";
import { useVapiVoiceAgent } from "@/hooks/use-vapi-voice-agent";
import {
  PAYTM_SALES_DIP_ASSISTANT_ID,
  PAYTM_SALES_DIP_ASSISTANT_NAME,
} from "@/lib/vapi-assistants";

import "./paytm-pos/styles.css";
import "./auto-advisor-call.css";
import { IphoneCallScreen, type IphoneCallCopy } from "./paytm-pos/iphone-call-screen";

const SALES_DIP_COPY: IphoneCallCopy = {
  kicker: "Paytm POS · Sales dip",
  liveKicker: "Live voice · Vapi",
  callerName: PAYTM_SALES_DIP_ASSISTANT_NAME,
  ringingHint: "Answer to talk through the sales dip with the merchant advisor.",
  liveHint: "Ask about footfall, stock, staffing, or a local event that could explain the drop.",
  endedHint: "Answer again to keep the conversation going.",
};

/**
 * End-of-slide-5 moment for the `/sales-dip` deck: the Paytm iPhone mockup,
 * hosting a live Vapi call with the Sales Dip Advisor.
 */
export function SalesDipCall({ onClose }: { onClose: () => void }) {
  const agent = useVapiVoiceAgent({
    publicKey: ENV.VITE_VAPI_PUBLIC_KEY,
    assistantId: PAYTM_SALES_DIP_ASSISTANT_ID,
  });

  return (
    <div className="paytm-pos auto-advisor-call">
      <div className="auto-advisor-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        className="auto-advisor-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sales-dip-call-title"
      >
        <button
          type="button"
          className="auto-advisor-close"
          aria-label="Close call and continue"
          onClick={onClose}
        >
          ×
        </button>

        <div className="auto-advisor-copy">
          <div className="eyebrow">Slide 5 · Live concept</div>
          <h2 id="sales-dip-call-title">Ask the merchant what changed</h2>
          <p>
            The owner sees the dip and the insights. Answer the phone to hear the follow-up call:
            ask whether a festival, stock issue, or staffing change explains the drop.
          </p>
          <div className="call-script">
            <strong>{PAYTM_SALES_DIP_ASSISTANT_NAME}</strong>
            <br />
            Ask about evening footfall, stock availability, or a local event that could explain the
            dip.
          </div>
          <button type="button" className="auto-advisor-skip" onClick={onClose}>
            Skip to slide 6 <ArrowRight size={14} />
          </button>
          <div className="auto-advisor-hint">
            The phone uses Vapi in your browser and may ask for microphone access. The slideshow
            pauses while this card is open.
          </div>
        </div>

        <div className="auto-advisor-phone">
          <IphoneCallScreen agent={agent} copy={SALES_DIP_COPY} onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
