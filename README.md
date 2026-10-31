# convex-vapi

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Start, Convex, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Start** - SSR framework with TanStack Router
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Convex** - Reactive backend-as-a-service platform
- **Authentication** - Better-Auth
- **Vite+** - Unified Vite toolchain, workspace task runner, linting, and formatting

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Voice Agent (Cloudflare + Sarvam)

The voice runtime is a Cloudflare Worker using `agents/voice`. Each call runs in
a Durable Object with:

- **STT:** Sarvam Saaras v4 over WebSocket
- **TTS:** Sarvam Bulbul
- **LLM:** per-agent, selectable (`sarvam`, `openai`, `anthropic`, or a
  Cloudflare/OpenAI-compatible gateway)
- **Persistence:** live transcript in Durable Object SQLite, synced to Convex
  when the call ends

The workspace-scoped builder at `/agents` versions the prompt, model, voice,
and transcriber, then publishes to the Cloudflare runtime. The copilot still
uses the Convex AI Gateway.

See [docs/voice-agent-builder.md](docs/voice-agent-builder.md) for the builder
and [docs/cloudflare-voice-runtime.md](docs/cloudflare-voice-runtime.md) for the
runtime.

### Setup

1. Add Sarvam and sync secrets to `packages/infra-voice/.env`:

   ```env
   SARVAM_API_KEY=...
   VOICE_SYNC_SECRET=...
   CONVEX_SITE_URL=https://<deployment>.convex.site
   ```

2. Set the same sync secret on Convex:

   ```bash
   cd packages/backend
   bunx convex env set VOICE_SYNC_SECRET "<same value>"
   ```

3. Deploy the runtime, or run it locally:

   ```bash
   bun run deploy:voice
   # or
   bun run dev:infra:voice
   ```

4. Point the web app at it:

   ```env
   VITE_VOICE_RUNTIME_URL=https://<voice-worker>
   VITE_VOICE_AGENT_ID=<optional default agent id>
   ```

5. Open an agent in the builder, choose **Use Sarvam stack**, publish, and
   click **Test call**.

No external voice-platform key or assistant is required.

## Convex Setup

This project uses Convex as a backend. You'll need to set up Convex before running the app:

```bash
bun run dev:setup
```

Follow the prompts to create a new Convex project and connect it to your application.

Copy environment variables from `packages/backend/.env.local` to `apps/*/.env`.

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
Your app will connect to the Convex cloud backend automatically.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@convex-vapi/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `bun run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

For Cloudflare, Alchemy loads and validates deployment inputs with `varlock/auto-load` in its Node/Bun deployment process. Worker code reads native bindings; web clients use the framework's public env API through `src/env.public.ts` where needed. Alchemy supplies resource URLs and managed database credentials. In-Worker Varlock protections are deferred until an official Alchemy integration is available; see [the non-Wrangler deployment guidance](https://varlock.dev/integrations/cloudflare/#non-wrangler-deploy-tools-alchemy-sst-pulumi).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Deployment

### Alchemy

- Target: web + voice runtime on Cloudflare
- Configure provider accounts: `cd packages/infra-web && bunx alchemy profile edit`
- Dev: bun run dev
- Deploy web: bun run deploy:web
- Deploy voice runtime: bun run deploy:voice
- Deploy both: bun run deploy
- Destroy: bun run destroy

Each stack has its own schema and state: `packages/infra-web` for the web
worker and `packages/infra-voice` for the voice runtime. The runtime is also
available during local emulation with `bun run dev:infra:voice`.

`alchemy profile edit` stores the selected Axiom, Cloudflare, Neon, PlanetScale, and/or Prisma provider profiles under `~/.alchemy`; no provider-specific setup command is required by this scaffold.

Deploys are staged and default to a personal `dev_<username>` stage. For production, run the deploy with an explicit stage from the owning stack:

```bash
cd packages/infra-web && bunx alchemy deploy --stage production
cd packages/infra-voice && bunx alchemy deploy --stage production
```

## Git Hooks and Formatting

- Optional native Vite+ hooks: `bun run hooks:setup`
- Docs: [Vite+ commit hooks](https://viteplus.dev/guide/commit-hooks)
- Run checks: `bun run check`

## Project Structure

```
convex-vapi/
├── apps/
│   ├── web/           # Frontend application (React + TanStack Start)
│   ├── voice-runtime/ # Cloudflare Agents voice runtime + Sarvam adapters
├── packages/
│   ├── ui/            # Shared shadcn/ui components and styles
│   ├── backend/       # Convex backend functions and schema
│   ├── sarvam/        # Shared Sarvam STT/TTS clients
│   ├── infra-web/     # Alchemy stack for the web worker
│   ├── infra-voice/   # Alchemy stack for the voice runtime
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run dev:all`: Start web, Convex and the voice runtime in parallel
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:setup`: Setup and configure your Convex project
- `bun run dev:infra:web`: Run the web stack in Cloudflare local emulation
- `bun run dev:infra:voice`: Run the voice runtime Worker locally
- `bun run deploy:web` / `bun run deploy:voice`: Deploy one stack
- `bun run deploy`: Deploy both stacks
- `bun run check-types`: Check TypeScript types across all apps
- `bun run check`: Run Vite+ format/lint checks and workspace TypeScript checks
- `bun run lint`: Run Vite+ lint checks
- `bun run format`: Run Vite+ formatting
- `bun run staged`: Run Vite+ checks against staged files
- `bun run hooks:setup`: Install Vite+ native Git hooks with `vp config`
