import crypto from "crypto";

function cleanEnv(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

export function isAuthRequired() {
  return Boolean(cleanEnv(process.env.SITE_PASSWORD));
}

function authSecret() {
  return cleanEnv(process.env.SITE_PASSWORD);
}

export function getSessionToken() {
  return crypto.createHmac("sha256", authSecret()).update("site-access-v1").digest("hex");
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function isAuthenticated(cookieHeader) {
  if (!isAuthRequired()) return true;
  const token = parseCookies(cookieHeader).site_session;
  const expected = getSessionToken();
  if (!token || token.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyPassword(password) {
  const expected = authSecret();
  if (!expected) return true;
  const a = Buffer.from(String(password ?? ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function buildSessionCookie() {
  const token = getSessionToken();
  const maxAge = 60 * 60 * 24 * 7;
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `site_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function authDeniedResponse() {
  return {
    status: 401,
    body: { error: "Нужна е парола. Влезте отново.", code: "auth_required" },
  };
}
