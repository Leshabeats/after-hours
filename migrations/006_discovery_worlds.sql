-- The existing GameDev state, checkpoints, snapshots, and metrics remain in world 1.
ALTER TABLE discovery_sync_state
  DROP CONSTRAINT discovery_sync_state_id_check,
  ADD CONSTRAINT discovery_sync_state_world_check CHECK (id BETWEEN 1 AND 5),
  ADD COLUMN github_retry_at BIGINT;

ALTER TABLE discovery_runs
  ADD COLUMN world_id INTEGER NOT NULL DEFAULT 1 CHECK (world_id BETWEEN 1 AND 5);
CREATE INDEX discovery_runs_world_completed ON discovery_runs (world_id, completed_at DESC)
  WHERE status = 'completed';

ALTER TABLE discovery_daily_metrics DROP CONSTRAINT discovery_daily_metrics_repo_id_fkey;
ALTER TABLE discovery_repositories
  ADD COLUMN world_id INTEGER NOT NULL DEFAULT 1 CHECK (world_id BETWEEN 1 AND 5),
  DROP CONSTRAINT discovery_repositories_pkey,
  ADD PRIMARY KEY (world_id, id);
CREATE INDEX discovery_repositories_visibility ON discovery_repositories (world_id, id)
  WHERE observation->>'isPublic' IS DISTINCT FROM 'true';

ALTER TABLE discovery_daily_metrics
  ADD COLUMN world_id INTEGER NOT NULL DEFAULT 1 CHECK (world_id BETWEEN 1 AND 5),
  DROP CONSTRAINT discovery_daily_metrics_pkey,
  ADD PRIMARY KEY (world_id, repo_id, day),
  ADD FOREIGN KEY (world_id, repo_id) REFERENCES discovery_repositories (world_id, id);
