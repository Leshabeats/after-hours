import type { LogStatus } from "./journal/types.ts";

/** Taking a night moves it to shipping, and leaves an already shipped night alone. */
export function shouldMarkShipping(status: LogStatus | undefined) {
  return status !== "shipped";
}
