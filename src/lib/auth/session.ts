import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { readAuthSecret, signPayload, verifyPayload } from "./secret";
import type { SessionUser } from "@/lib/journal/types";

export const SESSION_COOKIE = "ah_session";
export const OAUTH_COOKIE = "ah_oauth";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const OAUTH_MAX_AGE = 600;

type SessionPayload = SessionUser & { exp: number };
type OAuthPayload = { state: string; exp: number };

function cookieBase() {
  const secure = process.env.APP_ORIGIN?.startsWith("https:") ?? false;
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
  };
}

function serializeCookie(name: string, value: string, maxAge: number) {
  const base = cookieBase();
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (base.secure) parts.push("Secure");
  return parts.join("; ");
}

export function cookieFromRequest(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return undefined;
}

export function oauthStateCookie(state: string) {
  const token = signPayload(
    { state, exp: Date.now() + OAUTH_MAX_AGE * 1000 },
    readAuthSecret(),
  );
  return serializeCookie(OAUTH_COOKIE, token, OAUTH_MAX_AGE);
}

export function sessionCookie(user: SessionUser) {
  const token = signPayload(
    { ...user, exp: Date.now() + SESSION_MAX_AGE * 1000 },
    readAuthSecret(),
  );
  return serializeCookie(SESSION_COOKIE, token, SESSION_MAX_AGE);
}

export function clearCookie(name: string) {
  return serializeCookie(name, "", 0);
}

export function readOAuthStateFromRequest(request: Request) {
  const token = cookieFromRequest(request, OAUTH_COOKIE);
  if (!token) return null;
  const payload = verifyPayload<OAuthPayload>(token, readAuthSecret());
  if (!payload || payload.exp < Date.now() || !payload.state) return null;
  return payload.state;
}

function sessionFromToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const payload = verifyPayload<SessionPayload>(token, readAuthSecret());
  if (!payload || payload.exp < Date.now()) return null;
  if (!payload.id || !payload.login) return null;
  return {
    id: payload.id,
    login: payload.login,
    name: payload.name ?? "",
    avatarUrl: payload.avatarUrl ?? "",
  };
}

export function readSession(): SessionUser | null {
  return sessionFromToken(getCookie(SESSION_COOKIE));
}

export function readSessionFromRequest(request: Request): SessionUser | null {
  return sessionFromToken(cookieFromRequest(request, SESSION_COOKIE));
}

export function writeSession(user: SessionUser) {
  const token = signPayload(
    { ...user, exp: Date.now() + SESSION_MAX_AGE * 1000 },
    readAuthSecret(),
  );
  setCookie(SESSION_COOKIE, token, { ...cookieBase(), maxAge: SESSION_MAX_AGE });
}

export function clearSession() {
  deleteCookie(SESSION_COOKIE, cookieBase());
}

export function writeOAuthState(state: string) {
  const token = signPayload(
    { state, exp: Date.now() + OAUTH_MAX_AGE * 1000 },
    readAuthSecret(),
  );
  setCookie(OAUTH_COOKIE, token, { ...cookieBase(), maxAge: OAUTH_MAX_AGE });
}

export function readOAuthState(): string | null {
  const token = getCookie(OAUTH_COOKIE);
  if (!token) return null;
  const payload = verifyPayload<OAuthPayload>(token, readAuthSecret());
  if (!payload || payload.exp < Date.now() || !payload.state) return null;
  return payload.state;
}

export function clearOAuthState() {
  deleteCookie(OAUTH_COOKIE, cookieBase());
}
