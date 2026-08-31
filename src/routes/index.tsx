import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock } from "@/components/clock";
import { UrlIntake } from "@/components/url-intake";
import { Button } from "@/components/ui/button";
import { KIND_META, KINDS } from "@/lib/kinds";

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

      <header className="chrome-safe relative z-10 flex items-center justify-between px-4 py-4 sm:px-8">
        <p className="font-display text-2xl italic tracking-tight">After Hours</p>
        <Clock />
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
            Жги токены на ишьюсы стека, которым ты пользуешься. Баг Vite, ревью
            PR, ночь выбирает цель — или ты берёшь список.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row">
            <Button asChild variant="primary" size="lg" className="w-full sm:w-auto">
              <Link to="/fate">Как повезёт</Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="w-full sm:w-auto">
              <Link to="/list">Список ночи</Link>
            </Button>
          </div>

          <div className="mt-6 max-w-xl sm:mt-8">
            <p className="mb-2 text-xs uppercase tracking-caps text-muted">
              Свой issue
            </p>
            <UrlIntake tone="on-hero" />
          </div>
        </div>

        <ul className="no-scrollbar mt-8 flex gap-6 overflow-x-auto pb-1 sm:mt-12 sm:grid sm:grid-cols-4 sm:gap-x-6 sm:gap-y-3 sm:overflow-visible">
          {KINDS.map((kind) => (
            <li key={kind} className="min-w-36 shrink-0 sm:min-w-0">
              <p className="font-display text-lg italic leading-tight text-fg">
                {KIND_META[kind].track}
              </p>
              <p className="mt-0.5 text-xs text-muted">{KIND_META[kind].label}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
