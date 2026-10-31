import { mcp } from "../convex/mcp";

const findings = mcp.lint();
if (findings.length > 0) {
  console.error("MCP lint findings:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("MCP lint passed.");
