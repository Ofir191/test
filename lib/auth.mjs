import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const COOKIE = "mishmar_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 14;

export function cookieName() {
  return COOKIE;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const verify = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== verify.length) return false;
  return crypto.timingSafeEqual(expected, verify);
}

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // One shared fallback so login cookies stay valid across Vercel instances.
  // Replace it with SESSION_SECRET in the project settings for a real deployment.
  if (process.env.VERCEL) return "mishmar-vercel-demo-session-v1";
  const file = path.join(process.cwd(), "data", "session.secret");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const value = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, value, { mode: 0o600 });
  return value;
}

export function signSession(userId) {
  const body = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + MAX_AGE_SEC * 1000 }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readSession(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.uid || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
    secure: process.env.NODE_ENV === "production",
  };
}
