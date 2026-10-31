import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const backendDir = resolve(import.meta.dir, "..");
const dataDir = resolve(backendDir, "../../apps/web/public/data");

const payload = {
  transactionsCsv: readFileSync(resolve(dataDir, "auto_driver_transactions.csv"), "utf8"),
  opportunitiesCsv: readFileSync(resolve(dataDir, "auto_driver_opportunities.csv"), "utf8"),
};

const result = spawnSync("bunx", ["convex", "run", "autoDriver:seed", JSON.stringify(payload)], {
  cwd: backendDir,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
