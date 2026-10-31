import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Closes calls whose runtime disappeared (DO eviction, crash, dropped final
 * delivery). Without this, a dead call sits at `in-progress` forever and the
 * dashboard reports it as live.
 */
crons.interval("sweep stale voice calls", { minutes: 5 }, internal.calls.sweepStale, {});

export default crons;
