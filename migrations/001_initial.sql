-- Fresh PostgreSQL database. This migration does not import historical SQLite data.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE INDEX users_login ON users (lower(login));

CREATE TABLE journal (
  user_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  is_pr BOOLEAN NOT NULL,
  status TEXT NOT NULL,
  taken_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, mission_id)
);

CREATE TABLE usage_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL,
  at BIGINT NOT NULL,
  harness TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens BIGINT NOT NULL,
  output_tokens BIGINT NOT NULL,
  mission_id TEXT
);

CREATE INDEX usage_events_user_at
  ON usage_events (user_id, at);

CREATE TABLE connector_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  revoked_at BIGINT,
  last_used_at BIGINT
);

CREATE INDEX connector_grants_user
  ON connector_grants (user_id, created_at DESC);

CREATE TABLE research_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  is_pr BOOLEAN NOT NULL,
  thread_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  model TEXT,
  report_json JSONB,
  report_schema INTEGER,
  published_at BIGINT,
  delivery_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX research_runs_user
  ON research_runs (user_id, updated_at DESC);

CREATE INDEX research_runs_mission_published
  ON research_runs (lower(owner), lower(repo), number, published_at);

CREATE INDEX research_runs_user_published
  ON research_runs (user_id, published_at);

CREATE TABLE research_turns (
  run_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  status TEXT NOT NULL,
  usage_known BOOLEAN NOT NULL,
  input_tokens BIGINT,
  cached_input_tokens BIGINT,
  output_tokens BIGINT,
  reasoning_output_tokens BIGINT,
  total_tokens BIGINT,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (run_id, turn_id)
);

CREATE TABLE account_limit_snapshots (
  user_id TEXT PRIMARY KEY,
  read_at BIGINT NOT NULL,
  primary_used_percent DOUBLE PRECISION,
  primary_window_mins BIGINT,
  primary_resets_at BIGINT,
  secondary_used_percent DOUBLE PRECISION,
  secondary_window_mins BIGINT,
  secondary_resets_at BIGINT,
  spend_control_reached BOOLEAN,
  individual_remaining_percent DOUBLE PRECISION
);

CREATE TABLE github_subjects (
  id TEXT PRIMARY KEY,
  node_id TEXT,
  kind TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  author_login TEXT,
  title TEXT,
  html_url TEXT,
  is_public BOOLEAN,
  state TEXT NOT NULL,
  draft BOOLEAN NOT NULL DEFAULT FALSE,
  review TEXT,
  comment_count BIGINT,
  checked_at BIGINT,
  error TEXT,
  closing_known BOOLEAN NOT NULL DEFAULT FALSE,
  closing_json JSONB
);

CREATE UNIQUE INDEX github_subjects_node
  ON github_subjects (node_id) WHERE node_id IS NOT NULL;

CREATE UNIQUE INDEX github_subjects_coord
  ON github_subjects (kind, lower(owner), lower(repo), number);

CREATE TABLE research_links (
  id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  run_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (run_id, subject_id, relation)
);

CREATE TABLE github_facts (
  subject_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  at BIGINT NOT NULL,
  PRIMARY KEY (subject_id, kind, detail)
);

-- Shared across serverless instances; polling never holds this row during fetch.
CREATE TABLE github_watch_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused_until BIGINT NOT NULL DEFAULT 0
);
INSERT INTO github_watch_state (id) VALUES (1);
