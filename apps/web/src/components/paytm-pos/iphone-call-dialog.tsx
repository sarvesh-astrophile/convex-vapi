import { BatteryFull, Loader2, Mic, MicOff, Phone, PhoneOff, Signal, Wifi, X } from "lucide-react";
import { useEffect, useState } from "react";

import { ENV } from "@/env.public";
import {
  useVapiVoiceAgent,
  type VapiConnectionState,
  type VapiTurn,
} from "@/hooks/use-vapi-voice-agent";

const STATUS_LABEL: Record<VapiConnectionState, string> = {
  idle: "Incoming call",
  connecting: "Connecting…",
  active: "Connected",
  ending: "Ending…",
  ended: "Call ended",
  error: "Call unavailable",
};

function formatElapsed(seconds: number): string {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remaining = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function Turn({ turn, partial }: { turn: VapiTurn; partial?: boolean }) {
  return (
    <div className={`iphone-turn ${turn.role}${partial ? " partial" : ""}`}>
      <span className="iphone-turn-role">{turn.role === "user" ? "You" : "Agent"}</span>
      <span>{turn.text}</span>
    </div>
  );
}

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

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const isRinging = agent.connection === "idle" || agent.connection === "connecting";
  const isLive = agent.connection === "active";
  const transcript: Array<VapiTurn & { partial?: boolean }> = [
    ...agent.turns.slice(-4),
    ...(agent.partial ? [{ ...agent.partial, partial: true }] : []),
  ];

  useEffect(() => {
    if (agent.connection === "active" && startedAt === null) {
      setStartedAt(Date.now());
    }
    if (agent.connection === "idle" || agent.connection === "ended") {
      setStartedAt(null);
      setElapsed(0);
    }
  }, [agent.connection, startedAt]);

  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleAccept = () => {
    setElapsed(0);
    setStartedAt(null);
    void agent.start();
  };

  const handleDecline = () => {
    if (agent.isLive) {
      void agent.stop();
    }
    onClose();
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
        <div className="iphone-stage">
          <div className={`iphone-frame${isRinging ? " ringing" : ""}`}>
            <div className="iphone-island" />
            <div className="iphone-screen">
              <div className="iphone-statusbar">
                <span>9:41</span>
                <span className="iphone-statusbar-icons">
                  <Signal size={13} />
                  <Wifi size={13} />
                  <BatteryFull size={15} />
                </span>
              </div>

              <div className="iphone-call">
                <div className="iphone-call-top">
                  <span className="iphone-call-kicker">
                    {isLive ? "Voice help · Vapi" : "Paytm POS support"}
                  </span>
                  <div className="iphone-caller">{callerName}</div>
                  <div className="iphone-call-status">
                    {STATUS_LABEL[agent.connection]}
                    {isRinging ? (
                      <span className="iphone-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : null}
                  </div>
                  {isLive ? (
                    <div className="iphone-call-timer">{formatElapsed(elapsed)}</div>
                  ) : null}
                </div>

                <div className="iphone-avatar-wrap">
                  {isRinging ? (
                    <>
                      <span className="iphone-ring ring-one" />
                      <span className="iphone-ring ring-two" />
                      <span className="iphone-ring ring-three" />
                    </>
                  ) : null}
                  <div className={`iphone-avatar${isLive ? " live" : ""}`}>
                    <Phone size={30} />
                  </div>
                </div>

                {!agent.configured ? (
                  <div className="iphone-warning">
                    Voice help needs <code>VITE_VAPI_PUBLIC_KEY</code>.
                  </div>
                ) : agent.error ? (
                  <div className="iphone-warning error">{agent.error}</div>
                ) : null}

                <div className="iphone-transcript" aria-live="polite">
                  {transcript.length === 0 ? (
                    <p className="iphone-transcript-empty">
                      {isLive
                        ? "Say what happened — the assistant can hear you."
                        : isRinging
                          ? "Answer to talk to the support assistant."
                          : "Start the call again to continue."}
                    </p>
                  ) : (
                    transcript.map((turn) => (
                      <Turn
                        key={turn.id}
                        turn={turn}
                        partial={"partial" in turn ? turn.partial : undefined}
                      />
                    ))
                  )}
                </div>

                <div className="iphone-call-actions">
                  {isLive || agent.connection === "ending" ? (
                    <>
                      <button
                        type="button"
                        className="iphone-call-btn mute"
                        onClick={agent.toggleMute}
                        disabled={agent.connection !== "active"}
                        aria-label={agent.muted ? "Unmute" : "Mute"}
                      >
                        {agent.muted ? <MicOff size={20} /> : <Mic size={20} />}
                        <span>{agent.muted ? "Unmute" : "Mute"}</span>
                      </button>
                      <button
                        type="button"
                        className="iphone-call-btn end"
                        onClick={() => void agent.stop()}
                        disabled={agent.connection === "ending"}
                        aria-label="End call"
                      >
                        {agent.connection === "ending" ? (
                          <Loader2 size={20} className="iphone-spin" />
                        ) : (
                          <PhoneOff size={20} />
                        )}
                        <span>End</span>
                      </button>
                    </>
                  ) : agent.connection === "ended" ? (
                    <>
                      <button
                        type="button"
                        className="iphone-call-btn accept"
                        onClick={handleAccept}
                        disabled={!agent.configured}
                        aria-label="Call again"
                      >
                        <Phone size={20} />
                        <span>Call again</span>
                      </button>
                      <button
                        type="button"
                        className="iphone-call-btn end"
                        onClick={onClose}
                        aria-label="Close"
                      >
                        <X size={20} />
                        <span>Close</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="iphone-call-btn decline"
                        onClick={handleDecline}
                        aria-label="Decline"
                      >
                        <PhoneOff size={20} />
                        <span>Decline</span>
                      </button>
                      <button
                        type="button"
                        className="iphone-call-btn accept"
                        onClick={handleAccept}
                        disabled={
                          !agent.configured || !agent.ready || agent.connection === "connecting"
                        }
                        aria-label="Answer"
                      >
                        {agent.connection === "connecting" ? (
                          <Loader2 size={20} className="iphone-spin" />
                        ) : (
                          <Phone size={20} />
                        )}
                        <span>Answer</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="iphone-home-indicator" />
            </div>
          </div>
        </div>

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
