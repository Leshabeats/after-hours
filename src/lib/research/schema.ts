import { z } from "zod";
import { RUN_STATUSES, TURN_STATUSES } from "./types.ts";

const idSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{8,80}$/);

const tokenCount = z.number().int().nonnegative().max(1_000_000_000).nullable();

const usageSchema = z.object({
  inputTokens: tokenCount,
  cachedInputTokens: tokenCount,
  outputTokens: tokenCount,
  reasoningOutputTokens: tokenCount,
  totalTokens: tokenCount,
});

const turnSchema = z.object({
  turnId: idSchema,
  status: z.enum(TURN_STATUSES),
  usage: usageSchema.nullable(),
});

const reportSchema = z.object({
  schemaVersion: z.literal(1),
  findings: z.string().trim().min(1).max(8_000),
  work: z.string().trim().min(1).max(8_000),
  evidence: z.array(z.string().trim().min(1).max(2_000)).max(40),
  unknowns: z.array(z.string().trim().min(1).max(2_000)).max(40),
  nextSteps: z.array(z.string().trim().min(1).max(2_000)).max(40),
  links: z
    .array(
      z.object({
        url: z.string().trim().url().max(500),
        kind: z.string().trim().min(1).max(40),
      }),
    )
    .max(20),
});

const limitWindowSchema = z.object({
  usedPercent: z.number().min(0).max(100).nullable(),
  windowDurationMins: z.number().int().nonnegative().max(1_000_000).nullable(),
  resetsAt: z.number().int().nonnegative().nullable(),
});

const limitSchema = z.object({
  readAt: z.number().int().positive(),
  primary: limitWindowSchema.nullable(),
  secondary: limitWindowSchema.nullable(),
  spendControlReached: z.boolean().nullable(),
  individualRemainingPercent: z.number().min(0).max(100).nullable(),
});

/** Connector body. A client-sent `userId` is ignored. */
export const researchDeliverySchema = z.object({
  threadId: idSchema,
  missionId: z.string().trim().min(1).max(160),
  isPr: z.boolean(),
  status: z.enum(RUN_STATUSES),
  model: z.string().trim().min(1).max(80).optional(),
  report: reportSchema.optional(),
  turns: z.array(turnSchema).max(100).optional(),
  limit: limitSchema.optional(),
});

export type ResearchDeliveryInput = z.infer<typeof researchDeliverySchema>;
