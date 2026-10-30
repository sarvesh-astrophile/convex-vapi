#!/usr/bin/env bun
/**
 * Stream a WAV file into the bridge as if it came from Vapi.
 *
 * Usage:
 *   SARVAM_BRIDGE_SIGNING_SECRET=... bun run stream-wav.ts \
 *     --url "$(bun run sign-url.ts --base https://... --agent test-agent --lang hi-IN --mode codemix)" \
 *     --secret "$SARVAM_BRIDGE_SECRET" \
 *     --wav ./sample.wav
 *
 * Generate a Hindi sample first with:
 *   SARVAM_API_KEY=... bun run stream-wav.ts --url ... --secret ... --tts "नमस्ते, मेरा नाम सर्वेश है।"
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    secret: { type: "string" },
    wav: { type: "string" },
    tts: { type: "string" },
    lang: { type: "string", default: "hi-IN" },
    speaker: { type: "string", default: "shubh" },
    seconds: { type: "string", default: "4" },
  },
});

const url = values.url;
const secret = values.secret ?? process.env.SARVAM_BRIDGE_SECRET;
if (!url) {
  console.error("Missing --url");
  process.exit(1);
}
if (!secret) {
  console.error("Missing --secret or SARVAM_BRIDGE_SECRET");
  process.exit(1);
}

const wav = values.wav
  ? await readFile(values.wav)
  : values.tts
    ? await synthesize(values.tts, values.lang, values.speaker)
    : null;

if (!wav) {
  console.error("Pass --wav <path> or --tts <text>");
  process.exit(1);
}

const audio = decodeWav(wav);
console.log(`streaming ${(audio.pcm.length / (audio.sampleRate * 2)).toFixed(2)}s of audio`, {
  sampleRate: audio.sampleRate,
});

const socket = new WebSocket(url, {
  headers: { "x-vapi-secret": secret },
} as unknown as string[]);

const done = new Promise<void>((resolve, reject) => {
  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        type: "start",
        encoding: "linear16",
        container: "raw",
        sampleRate: audio.sampleRate,
        channels: 2,
      }),
    );

    const bytesPerFrame = 4;
    const chunkFrames = Math.max(1, Math.floor(audio.sampleRate / 10));
    const chunkBytes = chunkFrames * bytesPerFrame;
    let offset = 0;

    const timer = setInterval(() => {
      if (offset >= audio.pcm.length) {
        clearInterval(timer);
        setTimeout(
          () => {
            socket.close(1000, "done");
            resolve();
          },
          Number(values.seconds) * 1000,
        );
        return;
      }

      const slice = audio.pcm.subarray(offset, offset + chunkBytes);
      offset += chunkBytes;
      socket.send(interleaveCustomer(slice));
    }, 100);
  });

  socket.addEventListener("message", (event) => {
    console.log("bridge:", event.data);
  });
  socket.addEventListener("error", () => reject(new Error("bridge socket error")));
  socket.addEventListener("close", (event) => {
    console.log("closed", event.code, event.reason);
    resolve();
  });
});

await done;
process.exit(0);

function interleaveCustomer(mono: Uint8Array): ArrayBuffer {
  const frames = Math.floor(mono.length / 2);
  const output = new Uint8Array(frames * 4);
  for (let frame = 0; frame < frames; frame += 1) {
    output[frame * 4] = mono[frame * 2] ?? 0;
    output[frame * 4 + 1] = mono[frame * 2 + 1] ?? 0;
    // assistant channel stays silent
  }
  return output.buffer;
}

function decodeWav(buffer: Buffer): { pcm: Uint8Array; sampleRate: number } {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file");
  }

  let sampleRate = 16_000;
  let channels = 1;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === "fmt ") {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataOffset = body;
      dataLength = size;
      break;
    }

    offset = body + size + (size % 2);
  }

  if (dataOffset < 0) throw new Error("WAV has no data chunk");
  if (bitsPerSample !== 16) throw new Error("Only 16-bit PCM WAV is supported");

  const raw = buffer.subarray(dataOffset, dataOffset + dataLength);
  if (channels === 1) {
    return { pcm: raw, sampleRate };
  }

  // Keep the left channel of a stereo file.
  const frames = Math.floor(raw.length / 4);
  const mono = new Uint8Array(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    mono[frame * 2] = raw[frame * 4] ?? 0;
    mono[frame * 2 + 1] = raw[frame * 4 + 1] ?? 0;
  }
  return { pcm: mono, sampleRate };
}

async function synthesize(text: string, lang: string, speaker: string): Promise<Buffer> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new Error("Missing SARVAM_API_KEY for --tts");

  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      target_language_code: lang,
      speaker,
      model: "bulbul:v3",
      speech_sample_rate: 16_000,
      output_audio_codec: "wav",
    }),
  });

  if (!response.ok) {
    throw new Error(`Sarvam TTS ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const body = (await response.json()) as { audios?: string[] };
  const base64 = body.audios?.[0];
  if (!base64) throw new Error("Sarvam TTS returned no audio");
  return Buffer.from(base64, "base64");
}
