import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function FilterChip({
  active,
  className,
  asChild = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        "inline-flex h-11 shrink-0 items-center rounded-full px-4 text-xs tracking-wide transition-colors duration-150",
        active ? "bg-paper text-bg" : "text-muted shadow-border hover:text-fg",
        className,
      )}
      {...props}
    />
  );
}
