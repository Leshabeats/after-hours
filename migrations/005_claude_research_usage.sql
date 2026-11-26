CREATE TABLE claude_research_usage (
  run_id TEXT PRIMARY KEY REFERENCES research_runs(id) ON DELETE CASCADE,
  input_tokens BIGINT NOT NULL CHECK (input_tokens BETWEEN 0 AND 1000000000),
  output_tokens BIGINT NOT NULL CHECK (output_tokens BETWEEN 0 AND 1000000000),
  cache_creation_input_tokens BIGINT NOT NULL CHECK (cache_creation_input_tokens BETWEEN 0 AND 1000000000),
  cache_read_input_tokens BIGINT NOT NULL CHECK (cache_read_input_tokens BETWEEN 0 AND 1000000000)
);
