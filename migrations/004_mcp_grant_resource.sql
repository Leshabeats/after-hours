ALTER TABLE connector_grants ADD COLUMN resource TEXT;

-- Migration 003 issued expiring OAuth grants without an audience. Reconnect to replace them.
UPDATE connector_grants
SET revoked_at = (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT
WHERE expires_at IS NOT NULL AND revoked_at IS NULL;
