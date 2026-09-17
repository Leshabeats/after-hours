import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { githubOAuthConfigured } from "./flags.ts";

export { githubOAuthConfigured };

const MIN_SECRET_BYTES = 32;

export function readAuthSecret(): string {
  const fromEnv = process.env.AUTH_SECRET?.trim();
  if (fromEnv) {
    if (Buffer.byteLength(fromEnv) < MIN_SECRET_BYTES) {
      throw new Error("AUTH_SECRET must be at least 32 characters.");
    }
    return fromEnv;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required in production.");
  }
  const file = join(process.cwd(), "data", ".auth-secret");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing.length >= MIN_SECRET_BYTES) return existing;
  } catch {
    // create below
  }
  mkdirSync(dirname(file), { recursive: true });
  const generated = randomBytes(32).toString("hex");
  writeFileSync(file, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
  return generated;
}

export function signPayload(payload: object, secret: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyPayload<T>(token: string, secret: string): T | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
