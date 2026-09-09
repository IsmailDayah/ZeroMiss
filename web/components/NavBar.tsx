"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/arena", label: "Arena ⭐" },
  { href: "/fpv", label: "FPV" },
  { href: "/play", label: "Watch" },
  { href: "/play?adv=1", label: "Sandbox" },
  { href: "/duel", label: "Duel" },
  { href: "/compare", label: "Compare" },
  { href: "/storm", label: "Storm" },
  { href: "/montecarlo", label: "Monte Carlo" },
  { href: "/tracker", label: "Tracker" },
  { href: "/threed", label: "3-D" },
  { href: "/learn", label: "Learn" },
];

export function NavBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-50 border-b border-grid bg-bg/80 backdrop-blur">
      <nav className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 py-3">
        <Link href="/" className="group flex items-center gap-2">
          <span className="relative flex h-6 w-6 items-center justify-center">
            <span className="absolute inset-0 rounded-full border border-cyan/60" />
            <span className="absolute inset-0 origin-center rounded-full border-t border-cyan animate-sweep" />
            <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-glow" />
          </span>
          <span className="font-mono text-sm font-bold tracking-widest text-ink">
            ZERO<span className="text-cyan">MISS</span>
          </span>
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {LINKS.map((l) => {
            const active = pathname === l.href.split("?")[0];
            return (
              <Link
                key={l.label}
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-sm transition ${
                  active ? "bg-cyan/10 text-cyan" : "text-muted hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <a
            href="https://github.com/IsmailDayah/ZeroMiss"
            target="_blank"
            rel="noreferrer"
            className="ml-2 hidden rounded-md border border-grid px-3 py-1.5 text-sm text-muted hover:text-ink sm:inline-block"
          >
            GitHub
          </a>
        </div>
      </nav>
    </header>
  );
}
