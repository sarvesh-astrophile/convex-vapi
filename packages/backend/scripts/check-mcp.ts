import { mcp } from "../convex/mcp";
import { salesDipMcp } from "../convex/salesDipMcp";

let failed = false;

for (const [name, server] of [
  ["auto", mcp],
  ["sales-dip", salesDipMcp],
] as const) {
  const findings = server.lint();
  if (findings.length === 0) continue;
  failed = true;
  console.error(`MCP lint findings (${name}):`);
  for (const finding of findings) console.error(`- ${finding}`);
}

if (failed) process.exit(1);

console.log("MCP lint passed.");
