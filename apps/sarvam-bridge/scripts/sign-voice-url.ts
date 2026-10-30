#!/usr/bin/env bun
import { parseArgs } from "node:util";

import {
  parseVoiceConfig,
  signVoiceConfig,
  toVoiceSearchParams,
  type SarvamLanguage,
  type SarvamTtsModel,
} from "../src/protocol";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    agent: { type: "string", default: "test-agent" },
    lang: { type: "string", default: "hi-IN" },
    speaker: { type: "string", default: "shubh" },
    model: { type: "string", default: "bulbul:v3" },
  },
});

const baseUrl = values.base ?? process.env.SARVAM_VOICE_BRIDGE_URL;
const secret = process.env.SARVAM_BRIDGE_SIGNING_SECRET;

if (!baseUrl) {
  console.error("Missing SARVAM_VOICE_BRIDGE_URL (or --base).");
  process.exit(1);
}
if (!secret) {
  console.error("Missing SARVAM_BRIDGE_SIGNING_SECRET.");
  process.exit(1);
}

const parsed = parseVoiceConfig(
  new URL(
    `https://bridge.invalid/v1/voice?${new URLSearchParams({
      agent: values.agent,
      lang: values.lang,
      speaker: values.speaker,
      model: values.model,
    })}`,
  ),
);
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}

const config = {
  ...parsed.config,
  lang: parsed.config.lang as SarvamLanguage,
  model: parsed.config.model as SarvamTtsModel,
};

const signature = await signVoiceConfig(secret, config);
const url = new URL(baseUrl);
const search = toVoiceSearchParams(config);
search.set("sig", signature);
url.search = search.toString();

console.log(url.toString());
