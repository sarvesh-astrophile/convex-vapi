import { ArrowRight } from "lucide-react";

import { ENV } from "@/env.public";
import { useVapiVoiceAgent } from "@/hooks/use-vapi-voice-agent";
import {
  PAYTM_VEGETABLE_ADVISOR_ASSISTANT_ID,
  PAYTM_VEGETABLE_ADVISOR_ASSISTANT_NAME,
} from "@/lib/vapi-assistants";

import "./paytm-pos/styles.css";
import "./auto-advisor-call.css";
import { IphoneCallScreen, type IphoneCallCopy } from "./paytm-pos/iphone-call-screen";

const VEGETABLE_COPY: IphoneCallCopy = {
  kicker: "Paytm POS · Location advisor",
  liveKicker: "Live voice · Vapi",
  callerName: PAYTM_VEGETABLE_ADVISOR_ASSISTANT_NAME,
  ringingHint: "Answer to ask which selling location performed best.",
  liveHint: "Ask things like “which location sold the most in the last 30 days?”",
  endedHint: "Answer again to keep the conversation going.",
};

/**
 * End-of-slide-4 moment for the `/vegetable` deck: the Paytm iPhone mockup,
 * hosting a live Vapi call with the Location Advisor.
 */
export function VegetableCall({ onClose }: { onClose: () => void }) {
  const agent = useVapiVoiceAgent({
    publicKey: ENV.VITE_VAPI_PUBLIC_KEY,
    assistantId: PAYTM_VEGETABLE_ADVISOR_ASSISTANT_ID,
  });

  return (
    <div className="paytm-pos auto-advisor-call">
      <div className="auto-advisor-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        className="auto-advisor-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vegetable-call-title"
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
          <div className="eyebrow">Slide 4 · Live concept</div>
          <h2 id="vegetable-call-title">Ask about the best location</h2>
          <p>
            The vendor sees the top location recommendation. Answer the phone to ask the Location
            Advisor which spot performed best and why.
          </p>
          <div className="call-script">
            <strong>{PAYTM_VEGETABLE_ADVISOR_ASSISTANT_NAME}</strong>
            <br />
            Ask about the best-selling location, the last 30 days, or how the recommendation is
            chosen.
          </div>
          <button type="button" className="auto-advisor-skip" onClick={onClose}>
            Skip to slide 5 <ArrowRight size={14} />
          </button>
          <div className="auto-advisor-hint">
            The phone uses Vapi in your browser and may ask for microphone access. The slideshow
            pauses while this card is open.
          </div>
        </div>

        <div className="auto-advisor-phone">
          <IphoneCallScreen agent={agent} copy={VEGETABLE_COPY} onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
