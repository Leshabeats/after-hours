import { Link, useRouterState } from "@tanstack/react-router";
import { AccountControl, useAccount } from "@/components/account-session";
import { keepCatalogSearch } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const NAV = [
  { to: "/fate" as const, label: "Как повезёт", short: "Удача", catalog: true },
  { to: "/list" as const, label: "Список", short: "Список", catalog: true },
  { to: "/log" as const, label: "Журнал", short: "Журнал", catalog: false },
];

export function NightShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { entries } = useAccount();
  const shown = entries.length;

  return (
    <div className="relative min-h-dvh bg-bg text-fg">
      <div className="grain" aria-hidden="true" />
      <header className="sticky top-0 z-30 border-b border-border/80 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="shrink-0 font-display text-2xl italic tracking-tight text-fg"
          >
            After Hours
          </Link>
          <nav className="ml-auto flex items-center gap-0.5 sm:gap-1">
            {NAV.map((item) => {
              const active =
                pathname === item.to || pathname.startsWith(`${item.to}/`);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  search={item.catalog ? keepCatalogSearch : undefined}
                  className={cn(
                    "relative flex h-11 items-center px-2 text-xs tracking-wide sm:px-3 sm:text-sm",
                    active ? "text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  <span className="sm:hidden">{item.short}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                  {item.to === "/log" && shown > 0 ? (
                    <span className="ml-1.5 font-mono text-xs tabular-nums text-accent">
                      {shown}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
          <AccountControl />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">{children}</main>
    </div>
  );
}
