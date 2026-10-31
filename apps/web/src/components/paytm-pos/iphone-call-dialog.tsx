import { useEffect } from "react";

import { ENV } from "@/env.public";
import { useVapiVoiceAgent } from "@/hooks/use-vapi-voice-agent";

import { IphoneCallScreen, type IphoneCallCopy } from "./iphone-call-screen";

export function IphoneCallDialog({
  assistantId,
  callerName,
  script,
  onClose,
  onCopyScript,
  onCallCustomer,
}: {
  assistantId: string;
  callerName: string;
  script: string;
  onClose: () => void;
  onCopyScript: () => void;
  onCallCustomer: () => void;
}) {
  const agent = useVapiVoiceAgent({
    publicKey: ENV.VITE_VAPI_PUBLIC_KEY,
    assistantId,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const copy: IphoneCallCopy = {
    kicker: "Paytm POS support",
    liveKicker: "Voice help · Vapi",
    callerName,
    ringingHint: "Answer to talk to the support assistant.",
    liveHint: "Say what happened — the assistant can hear you.",
    endedHint: "Start the call again to continue.",
  };

  return (
    <div
      className="modal-backdrop iphone-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="iphone-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="iphone-call-title"
        onClick={(event) => event.stopPropagation()}
      >
        <IphoneCallScreen agent={agent} copy={copy} onClose={onClose} />

        <div className="iphone-dialog-side">
          <button
            type="button"
            className="iphone-dialog-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
          <div className="eyebrow">On-screen voice help</div>
          <h2 id="iphone-call-title">Need help with this sale?</h2>
          <p>
            Answer the phone to talk to the support assistant about what happened at the counter.
            You can also copy a reassuring script for the customer.
          </p>
          <div className="small-h">What to tell the customer</div>
          <div className="call-script">{script}</div>
          <div className="modal-actions">
            <button type="button" onClick={onCopyScript}>
              Copy script
            </button>
            <button type="button" className="primary" onClick={onCallCustomer}>
              Call customer ↗
            </button>
          </div>
          <div className="modal-hint">
            The phone uses Vapi in your browser and may ask for microphone access. Calls open your
            device dialler only when you enter a valid phone number.
          </div>
          {agent.callId ? <div className="iphone-call-reference">Call {agent.callId}</div> : null}
        </div>
      </div>
    </div>
  );
}
