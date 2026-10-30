import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

// Node's default Happy Eyeballs timeout (250ms) is too short on some
// WSL/network setups with a broken IPv6 route. Without this, server-side
// fetches to Convex fail with "fetch failed" during SSR.
setDefaultAutoSelectFamilyAttemptTimeout(1_000);

export default defineConfig({
  server: {
    port: 3001,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
  ssr: {
    noExternal: ["@convex-dev/better-auth"],
  },
});
