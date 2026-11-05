export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "גוף הבקשה אינו JSON תקין");
  }
}

export function idParam(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "מזהה לא תקין");
  return n;
}

export function assertRole(user, roles) {
  if (!roles.includes(user.role)) throw new HttpError(403, "אין הרשאה לפעולה הזו");
}

export function cleanText(value, max, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new HttpError(400, `חסר שדה: ${label}`);
  if (text.length > max) throw new HttpError(400, `${label} ארוך מדי`);
  return text;
}

export function optionalText(value, max) {
  const text = String(value ?? "").trim();
  if (text.length > max) throw new HttpError(400, "הטקסט ארוך מדי");
  return text || null;
}

export function optionalNumber(value, { min, max, label }) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, `${label} לא תקין`);
  }
  return n;
}
