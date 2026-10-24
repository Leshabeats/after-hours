-- Additive discovery cache. User/account tables are intentionally untouched.
CREATE TABLE discovery_repositories (
  id TEXT PRIMARY KEY,
  first_seen_at BIGINT NOT NULL,
  observed_at BIGINT NOT NULL,
  observation JSONB NOT NULL
);

CREATE TABLE discovery_daily_metrics (
  repo_id TEXT NOT NULL REFERENCES discovery_repositories (id),
  day DATE NOT NULL,
  observed_at BIGINT NOT NULL,
  stars BIGINT NOT NULL,
  forks BIGINT NOT NULL,
  PRIMARY KEY (repo_id, day)
);
CREATE INDEX discovery_daily_metrics_day ON discovery_daily_metrics (day);

CREATE TABLE discovery_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'interrupted', 'completed')),
  started_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  checkpoint JSONB,
  snapshot JSONB,
  completed_at BIGINT,
  error TEXT,
  CHECK ((status = 'completed') = (snapshot IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX discovery_runs_completed ON discovery_runs (completed_at DESC)
  WHERE status = 'completed';

CREATE TABLE discovery_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_run_id TEXT REFERENCES discovery_runs (id),
  published_run_id TEXT REFERENCES discovery_runs (id),
  fence BIGINT NOT NULL DEFAULT 0,
  lease_until BIGINT,
  retry_at BIGINT
);
INSERT INTO discovery_sync_state (id) VALUES (1);
