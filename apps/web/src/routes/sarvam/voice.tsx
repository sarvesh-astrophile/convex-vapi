import { api } from "@convex-vapi/backend/convex/_generated/api";
import type { Id } from "@convex-vapi/backend/convex/_generated/dataModel";
import { Button, buttonVariants } from "@convex-vapi/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@convex-vapi/ui/components/card";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { Loader2, Mic, MicOff, Phone, PhoneOff } from "lucide-react";

import { ENV } from "@/env.public";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import { useCloudflareVoice } from "@/hooks/use-cloudflare-voice";
import { formatDuration, formatTimestamp } from "@/lib/format";
import type { ConnectionState, LiveTurn, PipelineLatency, TurnLatency } from "@/lib/voice-types";

export const Route = createFileRoute("/sarvam/voice")({
  validateSearch: (search: Record<string, unknown>): { agent?: string } => {
    if (typeof search.agent === "string" && search.agent.length > 0) {
      return { agent: search.agent };
    }
    return {};
  },
  component: VoicePage,
});

const STATUS_LABEL: Record<ConnectionState, string> = {
  idle: "Ready",
  connecting: "Connecting…",
  active: "Live",
  ending: "Hanging up…",
  ended: "Call ended",
  error: "Error",
};

function statusDotClass(connection: ConnectionState): string {
  switch (connection) {
    case "active":
      return "bg-emerald-500 animate-pulse";
    case "connecting":
    case "ending":
      return "bg-amber-500 animate-pulse";
    case "error":
      return "bg-red-500";
    case "ended":
      return "bg-zinc-400";
    default:
      return "bg-zinc-500";
  }
}

function TurnBubble({ turn }: { turn: LiveTurn }) {
  const isUser = turn.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-md px-3 py-2 text-sm ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        }`}
      >
        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide opacity-60">
          {isUser ? "You" : "Agent"}
        </div>
        {turn.text}
      </div>
    </div>
  );
}

function formatMs(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

/** Bar scale: anything above this reads as "slow enough to fix". */
const LATENCY_BAR_MAX_MS = 2_500;

function LatencyBar({ label, value }: { label: string; value?: number }) {
  const ratio = value && value > 0 ? Math.min(value / LATENCY_BAR_MAX_MS, 1) : 0;
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{formatMs(value)}</span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${Math.max(ratio * 100, value ? 2 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function outcomeClass(outcome: string): string {
  switch (outcome) {
    case "completed":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600";
    case "no_output":
    case "output_limit":
      return "border-amber-500/40 bg-amber-500/10 text-amber-600";
    default:
      return "border-red-500/40 bg-red-500/10 text-red-600";
  }
}

type CallUsageRow = {
  turns: number;
  sttAudioMs: number;
  ttsCharacters: number;
  promptTokens: number;
  completionTokens: number;
  llmMs: number;
  ttsMs: number;
  firstAudioMs: number;
};

function LatencyCard({
  latest,
  history,
  pipeline,
  usage,
  connectMs,
  hasCall,
}: {
  latest: TurnLatency | null;
  history: TurnLatency[];
  pipeline: PipelineLatency | null;
  usage: CallUsageRow | null | undefined;
  connectMs: number | null;
  hasCall: boolean;
}) {
  const headline = latest?.replyMs ?? pipeline?.firstAudioMs;
  const recent = history.slice(-8);
  const historyMax = Math.max(1, ...recent.map((turn) => turn.replyMs ?? 0));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Latency</CardTitle>
        <CardDescription>
          Measured inside the Durable Object on one clock for the latest turn. Excludes browser
          playback and network transit.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {latest || pipeline ? (
          <>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <div className="text-3xl font-semibold tabular-nums">{formatMs(headline)}</div>
                <div className="text-muted-foreground text-[11px] uppercase tracking-wide">
                  Reply latency
                </div>
                <div className="text-muted-foreground mt-0.5 text-[10px]">
                  transcript final → first audio
                </div>
              </div>
              {latest ? (
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${outcomeClass(latest.outcome)}`}
                >
                  {latest.outcome}
                </span>
              ) : null}
            </div>

            <div className="grid gap-3">
              <LatencyBar label="STT finalization" value={latest?.sttFinalMs} />
              <LatencyBar label="Model first token" value={latest?.modelFirstTextMs} />
              <LatencyBar label="TTS first audio" value={latest?.ttsFirstAudioMs} />
              <LatencyBar label="Turn total" value={latest?.turnTotalMs ?? pipeline?.totalMs} />
            </div>

            {latest?.replyMs !== undefined && pipeline?.ttsMs !== undefined ? (
              <p className="text-muted-foreground text-[11px]">
                Server wall clock: LLM {formatMs(pipeline.llmMs)} · TTS work{" "}
                {formatMs(pipeline.ttsMs)} · first audio {formatMs(pipeline.firstAudioMs)}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground py-2 text-sm">
            No completed turn yet. Start a call and speak — timings appear after the first reply.
          </p>
        )}

        {recent.length > 0 ? (
          <div className="grid gap-2">
            <div className="text-muted-foreground text-[11px] uppercase tracking-wide">
              Turn history
            </div>
            <div className="grid gap-1">
              {recent.map((turn, index) => (
                <div key={turn.turnId} className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground w-5 shrink-0 tabular-nums">
                    #{index + 1}
                  </span>
                  <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{
                        width: `${Math.max(((turn.replyMs ?? 0) / historyMax) * 100, 2)}%`,
                      }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right font-mono tabular-nums">
                    {formatMs(turn.replyMs)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="border-t pt-4">
          {!hasCall ? (
            <p className="text-muted-foreground text-[11px]">
              Runtime metering appears here once a call starts.
            </p>
          ) : usage === undefined ? (
            <p className="text-muted-foreground text-[11px]">
              Waiting for the runtime's first event flush…
            </p>
          ) : usage === null ? (
            <p className="text-muted-foreground text-[11px]">
              Runtime metering is written about once a second while the call runs.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
              <Metric label="Runtime first audio" value={formatMs(usage.firstAudioMs)} />
              <Metric label="Turns" value={String(usage.turns)} />
              <Metric label="TTS characters" value={String(usage.ttsCharacters)} />
              <Metric label="LLM time" value={formatMs(usage.llmMs)} />
              <Metric label="TTS time" value={formatMs(usage.ttsMs)} />
              <Metric label="Tokens" value={`${usage.promptTokens} / ${usage.completionTokens}`} />
            </div>
          )}
        </div>

        {hasCall ? (
          <p className="text-muted-foreground text-[11px]">
            Start → call active: {formatMs(connectMs ?? undefined)} (mint, socket, token, config)
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

function VoicePage() {
  const { agent } = Route.useSearch();
  const agentId = agent && agent.length > 0 ? agent : ENV.VITE_VOICE_AGENT_ID;
  const { isAuthenticated } = useConvexAuth();
  const { workspace } = useActiveWorkspace();
  const agentDoc = useQuery(
    api.agents.get,
    isAuthenticated && agentId ? { agentId: agentId as Id<"agents"> } : "skip",
  );

  const call = useCloudflareVoice({
    agentId,
    workspaceId: agentDoc?.agent.workspaceId,
    enabled: Boolean(agentId),
  });

  const callsWorkspaceId = agentDoc?.agent.workspaceId ?? workspace?._id;
  const recentCalls = useQuery(
    api.calls.list,
    isAuthenticated ? { limit: 8, workspaceId: callsWorkspaceId } : "skip",
  );
  const callUsage = useQuery(
    api.calls.usageForCall,
    isAuthenticated && call.callId ? { callId: call.callId } : "skip",
  );

  const status = STATUS_LABEL[call.connection];
  const transcript: Array<LiveTurn & { partial?: boolean }> = [
    ...call.turns,
    ...(call.partial ? [{ ...call.partial, partial: true }] : []),
  ];
  const agentName = agentDoc?.agent.name ?? (agentId ? "Loading agent…" : "No agent selected");

  return (
    <div className="container mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="grid gap-6">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Voice agent</CardTitle>
              <CardDescription>
                Browser microphone call against a published agent. Audio streams over WebSocket to
                the Cloudflare voice runtime, with Sarvam STT/TTS and the agent's selected LLM.
              </CardDescription>
              {agentId ? (
                <p className="text-muted-foreground mt-1 font-mono text-[11px]">
                  Agent: {agentName}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
              <span className={`h-2 w-2 rounded-full ${statusDotClass(call.connection)}`} />
              {status}
            </div>
          </CardHeader>

          <CardContent className="grid gap-4">
            {!call.configured ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">Cloudflare voice runtime is not configured.</p>
                <p className="text-muted-foreground mt-1">
                  Open an agent and use <strong>Test call</strong>, or set{" "}
                  <code>VITE_VOICE_RUNTIME_URL</code> and <code>VITE_VOICE_AGENT_ID</code> in{" "}
                  <code>apps/web/.env</code>.
                </p>
              </div>
            ) : null}

            {call.error ? (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
                <p>{call.error}</p>
                <p className="text-muted-foreground mt-1 font-mono text-[11px]">
                  Runtime: {call.runtimeUrl || "not set"}
                </p>
                {call.runtimeUrl.startsWith("http://localhost") ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    This points at the local emulator. To use the deployed Worker, set{" "}
                    <code>VITE_VOICE_RUNTIME_URL</code> to its <code>https://…workers.dev</code> URL
                    and restart the dev server.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {call.isLive ? (
                <Button variant="destructive" onClick={() => void call.stop()}>
                  <PhoneOff />
                  End call
                </Button>
              ) : (
                <Button
                  onClick={() => void call.start()}
                  disabled={!call.configured || call.connection === "connecting"}
                >
                  {call.connection === "connecting" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Phone />
                  )}
                  {call.connection === "ended" ? "Start another call" : "Start call"}
                </Button>
              )}

              <Button variant="outline" onClick={call.toggleMute} disabled={!call.isLive}>
                {call.muted ? <MicOff /> : <Mic />}
                {call.muted ? "Unmute" : "Mute"}
              </Button>

              {call.callId ? (
                <span className="text-muted-foreground truncate text-xs">Call {call.callId}</span>
              ) : null}
            </div>

            <p className="text-muted-foreground font-mono text-[11px]">
              Durable Object: SarvamVoiceAgent/{call.callId ?? "no active call"}
            </p>

            <p className="text-muted-foreground text-xs">
              Audio streams over WebSocket to a per-call Durable Object, with Sarvam STT/TTS and the
              agent's selected LLM. Turns, timings, and tool calls are flushed into Convex about
              once a second while the call runs.
            </p>
          </CardContent>
        </Card>

        <LatencyCard
          latest={call.latestLatency}
          history={call.latencyHistory}
          pipeline={call.latency}
          usage={callUsage}
          connectMs={call.connectMs}
          hasCall={call.callId !== null}
        />

        <Card>
          <CardHeader>
            <CardTitle>Live transcript</CardTitle>
            <CardDescription>
              Incremental transcripts from the active call. Every turn is also flushed into Convex
              with its timings, so the call detail page works after the tab closes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex max-h-[420px] min-h-40 flex-col gap-3 overflow-y-auto pr-1">
              {transcript.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  Start a call and say hello to see the transcript here.
                </p>
              ) : (
                transcript.map((turn) => (
                  <div key={turn.id} className={turn.partial ? "opacity-60" : undefined}>
                    <TurnBubble turn={turn} />
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent calls</CardTitle>
            <CardDescription>Live from the calls table in Convex.</CardDescription>
          </div>
          <Link to="/sarvam/calls" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {recentCalls === undefined ? (
            <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
              <Loader2 className="animate-spin" /> Loading calls…
            </div>
          ) : recentCalls.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">No calls yet.</p>
          ) : (
            <ul className="divide-y">
              {recentCalls.map((recent) => (
                <li key={recent._id}>
                  <Link
                    to="/sarvam/calls/$callId"
                    params={{ callId: recent.callId }}
                    className="hover:bg-muted/50 block rounded-sm px-1 py-3 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium">
                        {recent.summary ?? "Untitled call"}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {recent.status}
                      </span>
                    </div>
                    <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
                      <span>{formatTimestamp(recent.createdAt)}</span>
                      <span>{formatDuration(recent.startedAt, recent.endedAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
