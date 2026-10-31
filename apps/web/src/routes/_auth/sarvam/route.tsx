import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/sarvam")({
  component: SarvamLayout,
});

const TABS = [
  { to: "/sarvam/agents", label: "Agents" },
  { to: "/sarvam/voice", label: "Voice" },
  { to: "/sarvam/calls", label: "Calls" },
] as const;

function SarvamLayout() {
  return (
    <div>
      <div className="border-b">
        <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-end justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-xl font-medium">Sarvam runtime</h1>
            <p className="text-muted-foreground text-sm">
              Browser voice calls on the Cloudflare runtime, powered by Sarvam STT/TTS.
            </p>
          </div>
          <nav className="flex items-center gap-1 text-sm">
            {TABS.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                className="text-muted-foreground hover:bg-muted rounded-sm px-3 py-1.5 transition-colors"
                activeProps={{ className: "bg-muted text-foreground rounded-sm px-3 py-1.5" }}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <Outlet />
    </div>
  );
}
