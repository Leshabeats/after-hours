-- MCP OAuth authorization codes are one-use and survive serverless restarts.
ALTER TABLE connector_grants ADD COLUMN expires_at BIGINT;
CREATE TABLE mcp_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX mcp_authorization_codes_expiry ON mcp_authorization_codes (expires_at);
