import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { parseGithubRef } from "@/lib/kinds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function UrlIntake({
  className,
  tone = "dark",
}: {
  className?: string;
  tone?: "dark" | "on-hero";
}) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseGithubRef(value);
    if (!parsed) {
      setError("Нужен URL GitHub issue или PR, либо owner/repo#123");
      return;
    }
    setError("");
    void navigate({
      to: "/m/$owner/$repo/$number",
      params: {
        owner: parsed.owner,
        repo: parsed.repo,
        number: String(parsed.number),
      },
    });
  }

  return (
    <form onSubmit={onSubmit} className={cn("w-full", className)}>
      <div className="flex items-stretch gap-2">
        <label className="sr-only" htmlFor="issue-url">
          Ссылка на issue
        </label>
        <input
          id="issue-url"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError("");
          }}
          placeholder="github.com/owner/repo/issues/…"
          suppressHydrationWarning
          className={cn(
            "h-12 min-h-11 min-w-0 flex-1 rounded-md bg-surface px-4 text-sm text-fg placeholder:text-faint shadow-border focus:outline-none focus:ring-2 focus:ring-accent/70",
            tone === "on-hero" && "bg-bg/70 backdrop-blur-sm",
          )}
        />
        <Button type="submit" variant="ghost" size="lg" className="shrink-0">
          Взять
        </Button>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-accent" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
