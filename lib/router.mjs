import { cookieName, hashPassword, readSession, sessionCookieOptions, signSession, verifyPassword } from "./auth.mjs";
import { getDb, q } from "./db.mjs";
import {
  archiveHouse,
  assignCall,
  buildReport,
  buildState,
  createUser,
  deleteArea,
  deletePolygon,
  deleteShift,
  importHouses,
  markNotificationsRead,
  openCall,
  publicUser,
  reportToCsv,
  saveArea,
  saveHouse,
  savePolygon,
  saveShift,
  setPresence,
  setStatus,
  updateSettings,
  updateUser,
  STATUS_LABEL,
} from "./domain.mjs";
import { publish, subscribe } from "./events.mjs";
import { houseTemplateBuffer, rowsFromWorkbook } from "./import.mjs";
import { assertRole, cleanText, HttpError, idParam, json, optionalNumber, optionalText, readJson } from "./http.mjs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

function match(method, path, spec) {
  const [expected, pattern] = spec.split(" ");
  if (expected !== method) return null;
  const actual = path.split("/").filter(Boolean);
  const parts = pattern.split("/").filter(Boolean);
  if (actual.length !== parts.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(":")) params[parts[i].slice(1)] = decodeURIComponent(actual[i]);
    else if (parts[i] !== actual[i]) return null;
  }
  return params;
}

function emailOf(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 160) throw new HttpError(400, "אימייל לא תקין");
  return email;
}

function passwordOf(value, required) {
  const password = String(value ?? "");
  if (!password && !required) return null;
  if (password.length < 6 || password.length > 72) throw new HttpError(400, "סיסמה חייבת להכיל 6 עד 72 תווים");
  return password;
}

function optionalId(value) {
  if (value === null || value === undefined || value === "") return null;
  return idParam(value);
}

function coord(value, label) {
  return optionalNumber(value, { min: label === "קו רוחב" ? -90 : -180, max: label === "קו רוחב" ? 90 : 180, label });
}

function pair(lat, lng) {
  if ((lat == null) !== (lng == null)) throw new HttpError(400, "צריך גם קו רוחב וגם קו אורך");
  return { lat, lng };
}

function daysOf(value) {
  if (!Array.isArray(value) || !value.length) throw new HttpError(400, "צריך לבחור לפחות יום אחד");
  const days = [...new Set(value.map(Number))];
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new HttpError(400, "יום בשבוע לא תקין");
  }
  return days.sort((a, b) => a - b);
}

function timeOf(value, label) {
  const time = String(value ?? "");
  if (!TIME.test(time)) throw new HttpError(400, `${label} לא תקין`);
  return time;
}

async function currentUser(db, cookiesApi) {
  const token = cookiesApi.get(cookieName())?.value;
  const session = token ? readSession(token) : null;
  if (!session) return null;
  return q(db).get(`SELECT * FROM users WHERE id = ? AND active = 1`, session.uid);
}

function done(db, user, extra) {
  publish(extra.reason);
  return json({ ok: true, ...extra, state: buildState(db, user) });
}

function areaInput(body, id) {
  const lat = coord(body.centerLat, "קו רוחב");
  const lng = coord(body.centerLng, "קו אורך");
  pair(lat, lng);
  const color = String(body.color || "#4aa3ff");
  if (!COLOR.test(color)) throw new HttpError(400, "צבע לא תקין");
  const radius = Number(body.radiusMeters ?? 2500);
  if (!Number.isInteger(radius) || radius < 200 || radius > 20000) {
    throw new HttpError(400, "רדיוס האזור חייב להיות בין 200 ל-20000 מטר");
  }
  return {
    id,
    name: cleanText(body.name, 80, "שם האזור"),
    description: optionalText(body.description, 400),
    color,
    centerLat: lat,
    centerLng: lng,
    radiusMeters: radius,
  };
}

function houseInput(body, id) {
  const lat = coord(body.lat, "קו רוחב");
  const lng = coord(body.lng, "קו אורך");
  pair(lat, lng);
  return {
    id,
    name: cleanText(body.name, 120, "שם"),
    phone: optionalText(body.phone, 40),
    address: optionalText(body.address, 200),
    lat,
    lng,
    areaId: optionalId(body.areaId),
    notes: optionalText(body.notes, 2000),
    ownerUserId: optionalId(body.ownerUserId),
  };
}

function userInput(body, { requirePassword }) {
  const password = passwordOf(body.password, requirePassword);
  return {
    email: emailOf(body.email),
    fullName: cleanText(body.fullName, 80, "שם"),
    phone: optionalText(body.phone, 40),
    role: String(body.role || ""),
    passwordHash: password ? hashPassword(password) : null,
    active: body.active,
    areaIds: Array.isArray(body.areaIds) ? body.areaIds.map(idParam) : undefined,
    shiftId: body.shiftId === undefined ? undefined : optionalId(body.shiftId),
  };
}

function shiftInput(body, id) {
  return {
    id,
    name: cleanText(body.name, 80, "שם המשמרת"),
    areaId: optionalId(body.areaId),
    startTime: timeOf(body.startTime, "שעת התחלה"),
    endTime: timeOf(body.endTime, "שעת סיום"),
    days: daysOf(body.days),
    active: body.active !== false,
  };
}

export async function handleApi(req, segments, cookiesApi) {
  const db = await getDb();
  const method = req.method;
  const path = `/${(segments ?? []).join("/")}`;
  const url = new URL(req.url);

  try {
    if (method === "POST" && path === "/login") {
      const body = await readJson(req);
      const email = String(body.email ?? "").trim().toLowerCase();
      const user = q(db).get(`SELECT * FROM users WHERE email = ?`, email);
      if (!user || !user.active || !verifyPassword(String(body.password ?? ""), user.password_hash)) {
        throw new HttpError(401, "אימייל או סיסמה שגויים");
      }
      cookiesApi.set(cookieName(), signSession(user.id), sessionCookieOptions());
      return json({ user: publicUser(user) });
    }
    if (method === "POST" && path === "/logout") {
      cookiesApi.delete(cookieName());
      return json({ ok: true });
    }

    const user = await currentUser(db, cookiesApi);
    if (!user) throw new HttpError(401, "נדרשת התחברות");

    if (method === "GET" && path === "/me") return json({ user: publicUser(user) });
    if (method === "GET" && path === "/state") return json(buildState(db, user));
    if (method === "GET" && path === "/stream") return stream(user);

    if (method === "POST" && path === "/calls") {
      assertRole(user, ["admin", "dispatcher", "authorized_user"]);
      const body = await readJson(req);
      const result = openCall(db, user, {
        houseId: idParam(body.houseId),
        notes: optionalText(body.notes, 2000),
      });
      return done(db, user, { ...result, reason: "call.opened" });
    }

    let params = match(method, path, "POST /calls/:id/status");
    if (params) {
      assertRole(user, ["admin", "dispatcher", "patrol"]);
      const body = await readJson(req);
      if (!STATUS_LABEL[body.status]) throw new HttpError(400, "סטטוס לא מוכר");
      const lat = coord(body.lat, "קו רוחב");
      const lng = coord(body.lng, "קו אורך");
      pair(lat, lng);
      const result = setStatus(db, user, idParam(params.id), body.status, {
        note: optionalText(body.note, 2000),
        lat,
        lng,
      });
      return done(db, user, { ...result, reason: "call.status" });
    }

    params = match(method, path, "POST /calls/:id/assign");
    if (params) {
      assertRole(user, ["admin", "dispatcher"]);
      const body = await readJson(req);
      const result = assignCall(db, user, idParam(params.id), idParam(body.patrolId));
      return done(db, user, { ...result, reason: "call.assigned" });
    }

    if (method === "POST" && path === "/polygons") {
      assertRole(user, ["admin", "dispatcher"]);
      const body = await readJson(req);
      const result = savePolygon(db, user, {
        name: optionalText(body.name, 120) || "פוליגון",
        confirmed: true,
        callIds: Array.isArray(body.callIds) ? body.callIds.map(idParam) : [],
      });
      return done(db, user, { ...result, reason: "polygon.saved" });
    }

    params = match(method, path, "PATCH /polygons/:id");
    if (params) {
      assertRole(user, ["admin", "dispatcher"]);
      const body = await readJson(req);
      const result = savePolygon(db, user, {
        id: idParam(params.id),
        name: optionalText(body.name, 120) || undefined,
        confirmed: body.confirmed !== false,
        callIds: Array.isArray(body.callIds) ? body.callIds.map(idParam) : [],
      });
      return done(db, user, { ...result, reason: "polygon.saved" });
    }

    params = match(method, path, "DELETE /polygons/:id");
    if (params) {
      assertRole(user, ["admin", "dispatcher"]);
      const result = deletePolygon(db, user, idParam(params.id));
      return done(db, user, { ...result, reason: "polygon.deleted" });
    }

    if (method === "POST" && path === "/presence") {
      const body = await readJson(req);
      const lat = coord(body.lat, "קו רוחב");
      const lng = coord(body.lng, "קו אורך");
      pair(lat, lng);
      setPresence(db, user, { active: !!body.active, lat, lng });
      return done(db, user, { reason: "presence" });
    }

    if (method === "POST" && path === "/notifications/read") {
      const body = await readJson(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(idParam) : [];
      markNotificationsRead(db, user.id, ids);
      return done(db, user, { reason: "notifications.read" });
    }

    if (method === "POST" && path === "/houses") {
      assertRole(user, ["admin"]);
      const body = await readJson(req);
      const id = saveHouse(db, houseInput(body));
      return done(db, user, { id, reason: "house.saved" });
    }
    params = match(method, path, "PATCH /houses/:id");
    if (params) {
      assertRole(user, ["admin"]);
      const body = await readJson(req);
      const id = saveHouse(db, houseInput(body, idParam(params.id)));
      return done(db, user, { id, reason: "house.saved" });
    }
    params = match(method, path, "DELETE /houses/:id");
    if (params) {
      assertRole(user, ["admin"]);
      archiveHouse(db, idParam(params.id));
      return done(db, user, { reason: "house.archived" });
    }
    if (method === "GET" && path === "/houses/template") {
      assertRole(user, ["admin"]);
      const buffer = houseTemplateBuffer();
      return new Response(buffer, {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": "attachment; filename=\"houses-template.xlsx\"",
          "cache-control": "no-store",
        },
      });
    }
    if (method === "POST" && path === "/houses/import") {
      assertRole(user, ["admin"]);
      let form;
      try {
        form = await req.formData();
      } catch {
        throw new HttpError(400, "הקובץ לא התקבל");
      }
      const file = form.get("file");
      if (!file || typeof file === "string") throw new HttpError(400, "לא נבחר קובץ");
      if (file.size > 2_000_000) throw new HttpError(400, "הקובץ גדול מדי");
      const rows = rowsFromWorkbook(Buffer.from(await file.arrayBuffer()));
      const result = importHouses(db, rows);
      return done(db, user, { ...result, reason: "houses.imported" });
    }

    if (method === "POST" && path === "/areas") {
      assertRole(user, ["admin"]);
      const id = saveArea(db, areaInput(await readJson(req)));
      return done(db, user, { id, reason: "area.saved" });
    }
    params = match(method, path, "PATCH /areas/:id");
    if (params) {
      assertRole(user, ["admin"]);
      const id = saveArea(db, areaInput(await readJson(req), idParam(params.id)));
      return done(db, user, { id, reason: "area.saved" });
    }
    params = match(method, path, "DELETE /areas/:id");
    if (params) {
      assertRole(user, ["admin"]);
      deleteArea(db, idParam(params.id));
      return done(db, user, { reason: "area.deleted" });
    }

    if (method === "POST" && path === "/users") {
      assertRole(user, ["admin"]);
      const id = createUser(db, userInput(await readJson(req), { requirePassword: true }));
      return done(db, user, { id, reason: "user.saved" });
    }
    params = match(method, path, "PATCH /users/:id");
    if (params) {
      assertRole(user, ["admin"]);
      const body = await readJson(req);
      const id = updateUser(db, user, idParam(params.id), userInput({ ...body, email: body.email }, { requirePassword: false }));
      return done(db, user, { id, reason: "user.saved" });
    }

    if (method === "POST" && path === "/shifts") {
      assertRole(user, ["admin"]);
      const id = saveShift(db, shiftInput(await readJson(req)));
      return done(db, user, { id, reason: "shift.saved" });
    }
    params = match(method, path, "PATCH /shifts/:id");
    if (params) {
      assertRole(user, ["admin"]);
      const id = saveShift(db, shiftInput(await readJson(req), idParam(params.id)));
      return done(db, user, { id, reason: "shift.saved" });
    }
    params = match(method, path, "DELETE /shifts/:id");
    if (params) {
      assertRole(user, ["admin"]);
      deleteShift(db, idParam(params.id));
      return done(db, user, { reason: "shift.deleted" });
    }

    if (method === "PATCH" && path === "/settings") {
      assertRole(user, ["admin"]);
      const body = await readJson(req);
      const polygonRadiusMeters = Number(body.polygonRadiusMeters);
      const gpsMatchMeters = Number(body.gpsMatchMeters);
      if (!Number.isInteger(polygonRadiusMeters) || polygonRadiusMeters < 50 || polygonRadiusMeters > 5000) {
        throw new HttpError(400, "רדיוס הפוליגון חייב להיות בין 50 ל-5000 מטר");
      }
      if (!Number.isInteger(gpsMatchMeters) || gpsMatchMeters < 200 || gpsMatchMeters > 20000) {
        throw new HttpError(400, "טווח ה-GPS חייב להיות בין 200 ל-20000 מטר");
      }
      updateSettings(db, user, { polygonRadiusMeters, gpsMatchMeters });
      return done(db, user, { reason: "settings" });
    }

    if (method === "GET" && (path === "/reports" || path === "/reports/export")) {
      assertRole(user, ["admin", "dispatcher"]);
      const status = url.searchParams.get("status") || null;
      if (status && !STATUS_LABEL[status]) throw new HttpError(400, "סטטוס לא מוכר");
      const report = buildReport(db, {
        from: url.searchParams.get("from") || undefined,
        to: url.searchParams.get("to") || undefined,
        areaId: url.searchParams.get("areaId") ? idParam(url.searchParams.get("areaId")) : null,
        patrolId: url.searchParams.get("patrolId") ? idParam(url.searchParams.get("patrolId")) : null,
        status,
      });
      if (path === "/reports/export") {
        return new Response(reportToCsv(report), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": "attachment; filename=\"calls.csv\"",
            "cache-control": "no-store",
          },
        });
      }
      return json(report);
    }

    throw new HttpError(404, "הנתיב לא נמצא");
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error(error);
    return json({ error: "שגיאה פנימית" }, 500);
  }
}

function stream() {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping;
  const body = new ReadableStream({
    start(controller) {
      const send = (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client gone */
        }
      };
      send({ type: "ready" });
      unsubscribe = subscribe(send);
      ping = setInterval(() => send({ type: "ping" }), 15000);
    },
    cancel() {
      unsubscribe();
      clearInterval(ping);
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
