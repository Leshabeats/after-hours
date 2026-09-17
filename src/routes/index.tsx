import { createFileRoute, Link } from "@tanstack/react-router";
import { AccountControl } from "@/components/account-session";
import { Clock } from "@/components/clock";
import { UrlIntake } from "@/components/url-intake";
import { Button } from "@/components/ui/button";
import { CATEGORIES } from "@/lib/catalog";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden bg-bg text-fg">
      <div className="grain" aria-hidden="true" />
      <img
        src="/hero.jpg"
        alt=""
        fetchPriority="high"
        className="hero-shot outline outline-1 -outline-offset-1 outline-fg/10"
      />
      <div className="hero-veil" aria-hidden="true" />

      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-8">
        <p className="font-display text-2xl italic tracking-tight">After Hours</p>
        <div className="flex items-center gap-3">
          <AccountControl />
          <Clock />
        </div>
      </header>

      <main className="hero-main relative z-10 mx-auto w-full max-w-5xl px-4 pb-8 sm:px-8 sm:pb-14">
        <div className="stagger-in max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-caps text-accent">
            Open source, after midnight
          </p>
          <h1 className="mt-3 font-display text-hero italic leading-none tracking-tight text-fg sm:mt-4">
            After
            <br />
            Hours
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-fg/90 sm:mt-6 sm:text-lg">
            Жги токены на живой опенсорс. Веб на виду сразу. Дальше — Go, ядро,
            что угодно.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row">
            <Button asChild variant="primary" size="lg" className="w-full sm:w-auto">
              <Link to="/fate" search={{ cat: "web" }}>
                Как повезёт
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="w-full sm:w-auto">
              <Link to="/list" search={{ cat: "web" }}>
                Список ночи
              </Link>
            </Button>
          </div>

          <div className="mt-6 max-w-xl sm:mt-8">
            <p className="mb-2 text-xs uppercase tracking-caps text-muted">
              Свой issue
            </p>
            <UrlIntake tone="on-hero" />
          </div>
        </div>

        <ul className="no-scrollbar mt-8 flex gap-6 overflow-x-auto pb-1 sm:mt-12 sm:grid sm:grid-cols-5 sm:gap-x-6 sm:gap-y-4 sm:overflow-visible">
          {CATEGORIES.map((item) => (
            <li key={item.id} className="min-w-36 shrink-0 sm:min-w-0">
              <Link
                to="/list"
                search={{ cat: item.id }}
                className="block hover:text-paper"
              >
                <p className="font-display text-lg italic leading-tight text-fg">
                  {item.label}
                </p>
                <p className="mt-0.5 text-xs text-muted">{item.hint}</p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
