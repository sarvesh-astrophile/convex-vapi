import type { Id } from "@convex-vapi/backend/convex/_generated/dataModel";
import { api } from "@convex-vapi/backend/convex/_generated/api";
import { Button } from "@convex-vapi/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@convex-vapi/ui/components/card";
import { Textarea } from "@convex-vapi/ui/components/textarea";
import { useAction, useQuery } from "convex/react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/errors";

const STARTER_PROMPTS = [
  "A friendly receptionist for a dental clinic that books appointments and answers common questions.",
  "A bilingual Hindi/English support agent for a payments app that explains failed transactions.",
  "An outbound sales assistant that qualifies leads, answers pricing questions, and books a demo.",
];

type BuilderChatProps = {
  assistantId: Id<"vapiAssistants">;
  assistantName: string;
};

export function BuilderChat({ assistantId, assistantName }: BuilderChatProps) {
  const messages = useQuery(api.vapiBuilder.messages, { assistantId });
  const chat = useAction(api.vapiBuilder.chat);

  const [input, setInput] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const lastMessage = messages?.[messages.length - 1];
  const showPending =
    pendingPrompt !== null && !(lastMessage?.role === "user" && lastMessage.text === pendingPrompt);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages?.length, pendingPrompt, isSending]);

  async function send(prompt: string) {
    const trimmed = prompt.trim();
    if (trimmed.length === 0 || isSending) {
      return;
    }

    setInput("");
    setPendingPrompt(trimmed);
    setIsSending(true);

    try {
      await chat({ assistantId, prompt: trimmed });
    } catch (error) {
      toast.error(errorMessage(error));
      setInput(trimmed);
    } finally {
      setPendingPrompt(null);
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(input);
  }

  return (
    <Card className="flex h-[calc(100vh-11rem)] min-h-[32rem] flex-col">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" /> Builder copilot
        </CardTitle>
        <CardDescription>
          Chat with the Convex agent to design <span className="font-medium">{assistantName}</span>.
          Every requested change is applied to the draft on the right.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages === undefined ? (
            <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
              <Loader2 className="animate-spin" /> Loading conversation…
            </div>
          ) : messages.length === 0 && !showPending ? (
            <div className="grid gap-3 py-2">
              <div>
                <p className="text-sm font-medium">Describe the assistant you want</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  The copilot writes the first message, system prompt, model, voice, and
                  transcriber, then keeps the draft in sync as you refine it.
                </p>
              </div>
              <div className="grid gap-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setInput(prompt)}
                    className="hover:bg-muted/60 rounded-sm border px-3 py-2 text-left text-xs transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex flex-col gap-1 ${message.role === "user" ? "items-end" : "items-start"}`}
              >
                <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                  {message.role === "user" ? "You" : "Builder"}
                </span>
                <div
                  className={`max-w-[92%] whitespace-pre-wrap rounded-md px-3 py-2 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {message.text}
                </div>
              </div>
            ))
          )}

          {showPending ? (
            <div className="flex flex-col items-end gap-1">
              <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                You
              </span>
              <div className="bg-primary text-primary-foreground max-w-[92%] whitespace-pre-wrap rounded-md px-3 py-2 text-sm leading-relaxed">
                {pendingPrompt}
              </div>
            </div>
          ) : null}

          {isSending ? (
            <div className="flex flex-col items-start gap-1">
              <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                Builder
              </span>
              <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-md px-3 py-2 text-sm">
                <Loader2 className="size-3.5 animate-spin" /> Designing…
              </div>
            </div>
          ) : null}
        </div>

        <form onSubmit={handleSubmit} className="grid gap-2 border-t p-3">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="e.g. Make the greeting warmer and add an escalation path for refunds."
            rows={3}
            maxLength={2_000}
            disabled={isSending}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-[11px]">
              Enter to send · Shift+Enter for a new line
            </span>
            <Button type="submit" size="sm" disabled={isSending || input.trim().length === 0}>
              {isSending ? <Loader2 className="animate-spin" /> : <Send />} Send
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
