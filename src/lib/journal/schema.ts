import { z } from "zod";
import { KINDS } from "../kinds.ts";
import { MAX_DEVICE_IMPORT } from "./import.ts";
import { LOG_STATUSES } from "./types.ts";

export { MAX_DEVICE_IMPORT };

export const takeInputSchema = z.object({
  id: z.string().min(1).max(220),
  owner: z.string().min(1).max(39),
  repo: z.string().min(1).max(100),
  number: z.number().int().positive(),
  title: z.string().min(1).max(300),
  kind: z.enum(KINDS),
  url: z.string().url().max(400),
  isPr: z.boolean(),
});

export const logEntrySchema = takeInputSchema.extend({
  status: z.enum(LOG_STATUSES),
  takenAt: z.number().int().positive(),
});

export function acceptedDeviceEntries(raw: readonly unknown[]) {
  const entries: z.infer<typeof logEntrySchema>[] = [];
  let skipped = 0;
  for (const item of raw) {
    const parsed = logEntrySchema.safeParse(item);
    if (parsed.success) entries.push(parsed.data);
    else skipped += 1;
  }
  return { entries, skipped };
}

/** Body for first-login upload. `userId` is not a field — session only. */
export const importDeviceJournalSchema = z
  .object({
    entries: z.array(z.unknown()).max(MAX_DEVICE_IMPORT),
  })
  .transform(({ entries }) => acceptedDeviceEntries(entries));
