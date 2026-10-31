import { ArrowRight } from "lucide-react";

import { ENV } from "@/env.public";
import { useVapiVoiceAgent } from "@/hooks/use-vapi-voice-agent";
import {
  PAYTM_AUTO_ADVISOR_ASSISTANT_ID,
  PAYTM_AUTO_ADVISOR_ASSISTANT_NAME,
} from "@/lib/vapi-assistants";

import "./paytm-pos/styles.css";
import "./auto-advisor-call.css";
import { IphoneCallScreen, type IphoneCallCopy } from "./paytm-pos/iphone-call-screen";

const ADVISOR_COPY: IphoneCallCopy = {
  kicker: "Paytm Auto · Opportunity",
  liveKicker: "Live voice · Vapi",
  callerName: PAYTM_AUTO_ADVISOR_ASSISTANT_NAME,
  ringingHint: "Answer to hear the demand suggestion near Christ College.",
  liveHint: "Ask about the pickup zone, timing, or expected demand.",
  endedHint: "Answer again to keep the conversation going.",
};

/**
 * End-of-slide-4 moment for the `/auto` deck: the Paytm POS iPhone mockup,
 * now hosting a live Vapi call with the Auto Opportunity Advisor.
 */
export function AutoAdvisorCall({ onClose }: { onClose: () => void }) {
  const agent = useVapiVoiceAgent({
    publicKey: ENV.VITE_VAPI_PUBLIC_KEY,
    assistantId: PAYTM_AUTO_ADVISOR_ASSISTANT_ID,
  });

  return (
    <div className="paytm-pos auto-advisor-call">
      <div className="auto-advisor-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        className="auto-advisor-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-advisor-title"
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
          <h2 id="auto-advisor-title">Suggestion, then a conversation</h2>
          <p>
            The driver sees the demand hint near Christ College. Answer the phone to hear the same
            advice from the voice assistant and ask follow-up questions.
          </p>
          <div className="call-script">
            <strong>{PAYTM_AUTO_ADVISOR_ASSISTANT_NAME}</strong>
            <br />
            Ask about the suggested pickup zone, the 5:00 PM exam rush, or how the opportunity is
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
          <IphoneCallScreen agent={agent} copy={ADVISOR_COPY} onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
