import { z } from "zod";

/** Body for harness reports. `userId` is not a field — session only. */
export const usageInputSchema = z.object({
  harness: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(80),
  inputTokens: z.number().int().nonnegative().max(1_000_000_000),
  outputTokens: z.number().int().nonnegative().max(1_000_000_000),
  missionId: z.string().trim().min(1).max(160).optional(),
  at: z.number().int().positive().optional(),
});

export type UsageInput = z.infer<typeof usageInputSchema>;
