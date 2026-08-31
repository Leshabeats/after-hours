import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export function Clock({ className }: { className?: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!now) {
    return (
      <div
        className={cn("h-4 w-16 sm:w-40", className)}
        aria-hidden="true"
      />
    );
  }

  const h = now.getHours();
  const after = h >= 22 || h < 6;

  return (
    <div
      className={cn(
        "flex items-baseline gap-3 font-mono text-xs tabular-nums tracking-wider",
        className,
      )}
    >
      <span className="text-fg">
        {pad(h)}:{pad(now.getMinutes())}:{pad(now.getSeconds())}
      </span>
      <span
        className={cn(
          "hidden sm:inline",
          after ? "text-accent" : "text-muted",
        )}
      >
        {after ? "AFTER HOURS" : "STILL LIGHT"}
      </span>
    </div>
  );
}
