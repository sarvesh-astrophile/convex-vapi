#!/usr/bin/env bun
import { parseArgs } from "node:util";

import {
  parseBridgeConfig,
  signBridgeConfig,
  toSearchParams,
  type BridgeChannels,
  type SarvamLanguage,
  type SarvamMode,
} from "../src/protocol";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    agent: { type: "string", default: "test-agent" },
    lang: { type: "string", default: "unknown" },
    mode: { type: "string", default: "transcribe" },
    channels: { type: "string", default: "customer" },
    keyterms: { type: "string" },
  },
});

const baseUrl = values.base ?? process.env.SARVAM_BRIDGE_URL;
const secret = process.env.SARVAM_BRIDGE_SIGNING_SECRET;

if (!baseUrl) {
  console.error("Missing SARVAM_BRIDGE_URL (or --base).");
  process.exit(1);
}
if (!secret) {
  console.error("Missing SARVAM_BRIDGE_SIGNING_SECRET.");
  process.exit(1);
}

const params = new URLSearchParams({
  agent: values.agent,
  lang: values.lang,
  mode: values.mode,
  channels: values.channels,
});
const keyterms = (values.keyterms ?? "")
  .split(",")
  .map((term) => term.trim())
  .filter(Boolean);
if (keyterms.length > 0) {
  params.set("keyterms", keyterms.join(","));
}

const parsed = parseBridgeConfig(new URL(`https://bridge.invalid/v1/transcriber?${params}`));
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}

const config = {
  ...parsed.config,
  lang: parsed.config.lang as SarvamLanguage,
  mode: parsed.config.mode as SarvamMode,
  channels: parsed.config.channels as BridgeChannels,
};

const signature = await signBridgeConfig(secret, config);
const url = new URL(baseUrl);
const search = toSearchParams(config);
search.set("sig", signature);
url.search = search.toString();
url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

console.log(url.toString());
