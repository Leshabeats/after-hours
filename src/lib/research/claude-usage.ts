import { z } from "zod";

export const CLAUDE_USAGE_PATH = "/api/research-usage";
export const mcpRunId = z.string().regex(/^mcp_[a-f0-9]{48}$/);

const counter = z.number().int().min(0).max(1_000_000_000);
export const claudeUsageSchema = z.strictObject({
  input_tokens: counter,
  output_tokens: counter,
  cache_creation_input_tokens: counter,
  cache_read_input_tokens: counter,
});

export const claudeUsageDeliverySchema = z.strictObject({
  run_id: mcpRunId,
  usage: claudeUsageSchema,
});

export type ClaudeUsage = z.infer<typeof claudeUsageSchema>;

export function claudeUsageTotal(usage: ClaudeUsage) {
  return (
    usage.input_tokens +
    usage.output_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens
  );
}

export function sameClaudeUsage(a: ClaudeUsage, b: ClaudeUsage) {
  return (
    a.input_tokens === b.input_tokens &&
    a.output_tokens === b.output_tokens &&
    a.cache_creation_input_tokens === b.cache_creation_input_tokens &&
    a.cache_read_input_tokens === b.cache_read_input_tokens
  );
}
