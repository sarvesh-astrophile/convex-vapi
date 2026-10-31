import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";

import { components } from "./_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  publishAgent: {
    kind: "token bucket",
    rate: 6,
    period: MINUTE,
    capacity: 2,
  },
  copilot: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 3,
  },
  testCall: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 3,
  },
  vapiCall: {
    kind: "token bucket",
    rate: 6,
    period: MINUTE,
    capacity: 2,
  },
  vapiBuilder: {
    kind: "token bucket",
    rate: 20,
    period: MINUTE,
    capacity: 5,
  },
  publishVapiAssistant: {
    kind: "token bucket",
    rate: 6,
    period: MINUTE,
    capacity: 2,
  },
});
