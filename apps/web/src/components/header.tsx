import { Link } from "@tanstack/react-router";

export default function Header() {
  const links = [
    { to: "/", label: "Home", badge: null },
    { to: "/agents", label: "Voice agents", badge: null },
    { to: "/voice", label: "Dialer", badge: null },
    { to: "/calls", label: "Call history", badge: null },
    { to: "/sarvam/agents", label: "Sarvam", badge: null },
    { to: "/paytm-pos-failure", label: "Paytm POS", badge: 1 },
    { to: "/auto", label: "Auto", badge: 2 },
    { to: "/sales-dip", label: "Sales dip", badge: 3 },
    { to: "/dashboard", label: "Dashboard", badge: null },
  ] as const;

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex items-center gap-4 text-lg">
          {links.map(({ to, label, badge }) => {
            return (
              <Link key={to} to={to} className="inline-flex items-center gap-1.5">
                {badge === null ? null : (
                  <span className="bg-foreground text-background inline-flex size-5 items-center justify-center rounded-full text-xs leading-none font-semibold">
                    {badge}
                  </span>
                )}
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2"></div>
      </div>
      <hr />
    </div>
  );
}
