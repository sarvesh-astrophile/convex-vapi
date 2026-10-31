import { BatteryFull, Loader2, Mic, MicOff, Phone, PhoneOff, Signal, Wifi, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { VapiConnectionState, VapiTurn, VapiVoiceAgent } from "@/hooks/use-vapi-voice-agent";

const STATUS_LABEL: Record<VapiConnectionState, string> = {
  idle: "Incoming call",
  connecting: "Connecting…",
  active: "Connected",
  ending: "Ending…",
  ended: "Call ended",
  error: "Call unavailable",
};

export type IphoneCallCopy = {
  /** Kicker shown while the phone is ringing. */
  kicker: string;
  /** Kicker shown once the call is live. */
  liveKicker: string;
  callerName: string;
  /** Placeholder shown in the transcript while ringing. */
  ringingHint: string;
  /** Placeholder shown in the transcript while live. */
  liveHint: string;
  /** Placeholder shown in the transcript after the call ends. */
  endedHint: string;
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

/**
 * Presentational iPhone frame for a Vapi browser call. The owning surface
 * creates the agent with `useVapiVoiceAgent` and passes it in, so the same
 * phone can be dropped into the POS dialog or the /auto slideshow.
 */
export function IphoneCallScreen({
  agent,
  copy,
  onClose,
}: {
  agent: VapiVoiceAgent;
  copy: IphoneCallCopy;
  onClose: () => void;
}) {
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
              <span className="iphone-call-kicker">{isLive ? copy.liveKicker : copy.kicker}</span>
              <div className="iphone-caller">{copy.callerName}</div>
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
              {isLive ? <div className="iphone-call-timer">{formatElapsed(elapsed)}</div> : null}
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
                  {isLive ? copy.liveHint : isRinging ? copy.ringingHint : copy.endedHint}
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
  );
}
