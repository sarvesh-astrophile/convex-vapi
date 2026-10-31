/**
 * Guards that keep the spoken conversation from looping.
 *
 * Voice calls have two failure modes that look like "the agent repeats itself":
 *
 * 1. Background noise or the agent's own TTS bleeding back through the mic is
 *    transcribed as a short fragment ("आप।", "मैं।", "Up."). The model then
 *    answers that fragment with a fresh greeting.
 * 2. Small models (sarvam-105b in particular) re-emit the canned greeting or
 *    self-introduction even when the prompt forbids it.
 *
 * `evaluateTranscript` drops the junk before it reaches the model, and
 * `guardReplyStream` removes greeting/duplicate sentences from the model output
 * before it reaches Sarvam TTS.
 */

const GREETING_PREFIXES = ["नमस्ते", "नमस्कार", "हाय", "हैलो", "hello", "hi", "hey"];

const SEPARATORS = /^[\s,.!?।,:;-]+/;

/** Fragments that carry no intent when they arrive as a whole turn. */
const FILLERS = new Set(["आप", "मैं", "up", "uh", "um", "hmm", "हम्म", "ok", "okay", "ओके"]);

const SENTENCE_END = /[.!?।\n]/;
const DEVANAGARI = /[\u0900-\u097F]/;

const IDENTITY_QUESTION =
  /(कौन|किससे|पहचान|मॉडल|model|who\s+are\s+you|your\s+name|आपका\s+नाम|तुम्हारा\s+नाम)/iu;

const SELF_INTRO =
  /^(?:मैं|i am|i'm)\s[^.?!।\n]{0,60}(?:\bAI\b|digital assistant|virtual assistant|voice assistant|डिजिटल सहायक|सहायक हूँ|सहायक हूं)/iu;

/** "मैं आपकी कैसे मदद कर सकता हूँ?" / "How can I help you?" */
const CANNED_HELP =
  /^(?:(?:मैं|main)\s+)?(?:आपकी|आप\s+की|आपके)\s+(?:कैसे|किस\s+तरह)\s+(?:मदद|सहायता)|^(?:how\s+can|how\s+may)\s+i\s+(?:help|assist)|^(?:i\s+am|i'm)\s+here\s+to\s+help/iu;

export type TranscriptDecision =
  | { accept: true; text: string }
  | { accept: false; reason: "empty" | "filler" | "echo" };

export type ReplyGuardOptions = {
  /** The transcript this reply answers, used for identity questions and language. */
  transcript: string;
  /** Assistant messages already spoken in this call, oldest first. */
  spoken: string[];
};

export function normalizeForCompare(text: string): string {
  return (
    text
      .toLowerCase()
      // Keep combining marks so Devanagari vowels survive ("मैं", not "म").
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, "")
  );
}

/** Strip one or more leading greetings from a sentence. */
export function removeGreeting(text: string): string {
  let output = text.trimStart();
  let changed = true;

  while (changed && output.length > 0) {
    changed = false;
    const lowered = output.toLowerCase();
    for (const prefix of GREETING_PREFIXES) {
      if (!lowered.startsWith(prefix)) continue;
      const rest = output.slice(prefix.length);
      // Require a separator so "hindi" is not treated as "hi".
      if (rest.length > 0 && !SEPARATORS.test(rest)) continue;
      output = rest.replace(SEPARATORS, "");
      changed = true;
      break;
    }
  }

  return output;
}

function isEcho(transcript: string, spoken: string[]): boolean {
  const value = normalizeForCompare(transcript);
  // Short fragments are handled by the filler rule; only long overlaps are echo.
  if (value.length < 6) return false;
  return spoken.some((text) => normalizeForCompare(text).includes(value));
}

/** Decide whether a transcript should become a model turn at all. */
export function evaluateTranscript(transcript: string, spoken: string[]): TranscriptDecision {
  const text = transcript.trim();
  if (text.length === 0) return { accept: false, reason: "empty" };

  const normalized = normalizeForCompare(text);
  if (normalized.length === 0) return { accept: false, reason: "empty" };
  if (FILLERS.has(normalized)) return { accept: false, reason: "filler" };
  if (isEcho(text, spoken)) return { accept: false, reason: "echo" };

  return { accept: true, text };
}

function takeSentence(buffer: string): { sentence: string; rest: string } | null {
  const match = SENTENCE_END.exec(buffer);
  if (!match) return null;
  const end = match.index + 1;
  return { sentence: buffer.slice(0, end), rest: buffer.slice(end) };
}

function isDuplicate(candidate: string, spoken: string[]): boolean {
  const value = normalizeForCompare(candidate);
  if (value.length < 8) return false;
  return spoken.some((text) => normalizeForCompare(text).includes(value));
}

function sanitizeSentence(sentence: string, options: ReplyGuardOptions, identityAsked: boolean) {
  const trimmed = sentence.trim();
  if (trimmed.length === 0) return "";

  const withoutGreeting = removeGreeting(trimmed).trim();
  if (withoutGreeting.length === 0) return "";

  // "नमस्ते सर्वेश!" is a greeting plus a vocative: drop the whole sentence.
  if (withoutGreeting !== trimmed) {
    const words = withoutGreeting.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
    if (words.length < 2) return "";
  }

  if (isDuplicate(withoutGreeting, options.spoken)) return "";
  if (CANNED_HELP.test(withoutGreeting)) return "";
  if (!identityAsked && SELF_INTRO.test(withoutGreeting)) return "";

  return withoutGreeting;
}

export function fallbackReply(transcript: string): string {
  return DEVANAGARI.test(transcript) ? "जी, बताइए?" : "Go ahead, please.";
}

/**
 * Drop greetings, canned "how can I help" lines, self-introductions and any
 * sentence already spoken in this call. Emission starts as soon as the first
 * acceptable sentence is complete so TTS latency is unchanged.
 */
export async function* guardReplyStream(
  stream: AsyncIterable<string>,
  options: ReplyGuardOptions,
): AsyncGenerator<string> {
  const identityAsked = IDENTITY_QUESTION.test(options.transcript);
  let pending = "";
  let spokeSomething = false;

  for await (const chunk of stream) {
    pending += chunk;

    for (;;) {
      const next = takeSentence(pending);
      if (!next) break;

      const keep = sanitizeSentence(next.sentence, options, identityAsked);
      pending = next.rest;

      if (keep.length > 0) {
        spokeSomething = true;
        yield `${keep} `;
      }
    }

    // Run-on reply without punctuation: stop holding the audio back.
    if (pending.trim().length >= 160) {
      const keep = sanitizeSentence(pending, options, identityAsked);
      pending = "";
      if (keep.length > 0) {
        spokeSomething = true;
        yield `${keep} `;
      }
    }
  }

  const tail = sanitizeSentence(pending, options, identityAsked);
  if (tail.length > 0) {
    yield tail;
    return;
  }

  if (!spokeSomething) {
    yield fallbackReply(options.transcript);
  }
}
