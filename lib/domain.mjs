import { clusterByDistance, haversine } from "./geo.mjs";
import { HttpError } from "./http.mjs";
import { q, tx } from "./db.mjs";
import { jerusalemDate, nowIso, shiftCovers } from "./time.mjs";

export const STATUS_LABEL = {
  new: "נשלחה",
  received: "התקבלה",
  en_route: "בדרך",
  arrived: "הגיע",
  closed: "נסגרה",
};

const NEXT_STATUS = {
  new: ["received", "en_route", "arrived", "closed"],
  received: ["en_route", "arrived", "closed"],
  en_route: ["arrived", "closed"],
  arrived: ["closed"],
  closed: [],
};

const STAMP = {
  received: "received_at",
  en_route: "en_route_at",
  arrived: "arrived_at",
  closed: "closed_at",
};

const AREA_COLORS = ["#3dcaa0", "#4aa3ff", "#e8a838", "#ef6b6b", "#c084fc", "#7dd3fc"];

function settingsMap(db) {
  const rows = q(db).all("SELECT key, value FROM settings");
  const map = {
    polygon_radius_meters: "500",
    gps_match_meters: "3000",
  };
  for (const row of rows) map[row.key] = row.value;
  return map;
}

export function getSettings(db) {
  const map = settingsMap(db);
  return {
    polygonRadiusMeters: Number(map.polygon_radius_meters),
    gpsMatchMeters: Number(map.gps_match_meters),
  };
}

function userById(db, id) {
  return q(db).get(
    `SELECT id, email, full_name, phone, role, active, created_at FROM users WHERE id = ?`,
    id,
  );
}

function houseById(db, id) {
  return q(db).get(`SELECT * FROM houses WHERE id = ?`, id);
}

function callById(db, id) {
  return q(db).get(`SELECT * FROM calls WHERE id = ?`, id);
}

function patrolRecord(db, userId) {
  const user = q(db).get(
    `SELECT u.id, u.email, u.full_name, u.phone, u.role, u.active,
            p.is_active, p.lat, p.lng, p.location_updated_at, p.shift_id
     FROM users u
     LEFT JOIN patrol_profiles p ON p.user_id = u.id
     WHERE u.id = ? AND u.role = 'patrol'`,
    userId,
  );
  if (!user) return null;
  const areas = q(db).all(`SELECT area_id FROM patrol_areas WHERE user_id = ?`, userId);
  const shift = user.shift_id
    ? q(db).get(`SELECT * FROM shifts WHERE id = ?`, user.shift_id)
    : null;
  return {
    ...user,
    areaIds: areas.map((a) => a.area_id),
    shift,
    onShift: shift ? shiftCovers(shift) : true,
  };
}

function listPatrolRecords(db) {
  const users = q(db).all(
    `SELECT u.id FROM users u WHERE u.role = 'patrol' ORDER BY u.full_name`,
  );
  return users.map((u) => patrolRecord(db, u.id)).filter(Boolean);
}

export function eligiblePatrols(db, house) {
  const { gpsMatchMeters } = getSettings(db);
  return listPatrolRecords(db)
    .map((patrol) => {
      const areaMatch = house.area_id != null && patrol.areaIds.includes(house.area_id);
      const dist =
        patrol.lat != null && house.lat != null
          ? haversine(patrol.lat, patrol.lng, house.lat, house.lng)
          : null;
      const gpsMatch = dist != null && dist <= gpsMatchMeters;
      const shiftOk = !patrol.shift_id || patrol.onShift;
      const match = !!patrol.active && !!patrol.is_active && shiftOk && (areaMatch || gpsMatch);
      let reason = null;
      if (!patrol.active) reason = "חשבון לא פעיל";
      else if (!patrol.is_active) reason = "לא סימן פעיל";
      else if (!shiftOk) reason = "מחוץ למשמרת";
      else if (!areaMatch && !gpsMatch) reason = "מחוץ לאזור ולטווח המיקום";
      return { ...patrol, dist, areaMatch, gpsMatch, shiftOk, match, reason };
    })
    .filter((p) => p.match)
    .sort((a, b) => {
      if (a.dist == null && b.dist == null) return a.id - b.id;
      if (a.dist == null) return 1;
      if (b.dist == null) return -1;
      return a.dist - b.dist;
    });
}

function insertEvent(db, callId, status, actorId, note, at, lat, lng) {
  q(db).run(
    `INSERT INTO call_events (call_id, status, actor_id, note, lat, lng, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    callId,
    status,
    actorId,
    note ?? null,
    lat ?? null,
    lng ?? null,
    at,
  );
}

function notify(db, userIds, { callId, title, body, at }) {
  const unique = [...new Set(userIds.filter((id) => id != null))];
  for (const userId of unique) {
    q(db).run(
      `INSERT INTO notifications (user_id, call_id, title, body, read, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      userId,
      callId ?? null,
      title,
      body,
      at,
    );
  }
}

function staffIds(db, exceptId) {
  return q(db)
    .all(
      `SELECT id FROM users WHERE role IN ('admin', 'dispatcher') AND active = 1 AND id != ?`,
      exceptId ?? 0,
    )
    .map((r) => r.id);
}

function houseLabel(house) {
  return [house.name, house.address].filter(Boolean).join(", ");
}

export function recomputeSuggestions(db, actorId) {
  const radius = getSettings(db).polygonRadiusMeters;
  const locked = new Set(
    q(db)
      .all(
        `SELECT pc.call_id AS id
         FROM polygon_calls pc
         JOIN polygons p ON p.id = pc.polygon_id
         WHERE p.confirmed = 1`,
      )
      .map((r) => r.id),
  );
  const dismissed = new Set(
    q(db)
      .all(`SELECT signature FROM suggestion_dismissals`)
      .map((row) => row.signature),
  );
  const suggestedIds = q(db)
    .all(`SELECT id FROM polygons WHERE confirmed = 0`)
    .map((r) => r.id);
  for (const id of suggestedIds) {
    q(db).run(`DELETE FROM polygons WHERE id = ?`, id);
  }

  const open = q(db)
    .all(
      `SELECT c.id, c.house_id, h.lat, h.lng, h.name, h.area_id
       FROM calls c JOIN houses h ON h.id = c.house_id
       WHERE c.status != 'closed'`,
    )
    .filter((c) => !locked.has(c.id) && c.lat != null && c.lng != null);

  const groups = clusterByDistance(open, radius).filter((g) => g.length >= 2);
  const at = nowIso();
  const created = [];
  for (const group of groups) {
    const signature = group
      .map((call) => call.id)
      .sort((a, b) => a - b)
      .join(",");
    if (dismissed.has(signature)) continue;
    const names = group
      .map((c) => c.name)
      .slice(0, 2)
      .join(" · ");
    const extra = group.length > 2 ? ` +${group.length - 2}` : "";
    const row = q(db).run(
      `INSERT INTO polygons (name, confirmed, radius_meters, created_by, created_at)
       VALUES (?, 0, ?, ?, ?)`,
      `הצעה · ${names}${extra}`,
      radius,
      actorId ?? null,
      at,
    );
    for (const call of group) {
      q(db).run(
        `INSERT INTO polygon_calls (polygon_id, call_id) VALUES (?, ?)`,
        row.id,
        call.id,
      );
    }
    created.push(row.id);
  }
  return created;
}

export function openCall(db, actor, { houseId, notes }) {
  return tx(db, () => {
    const house = houseById(db, houseId);
    if (!house || house.archived) throw new HttpError(404, "הבית לא נמצא");
    if (actor.role === "authorized_user" && house.owner_user_id !== actor.id) {
      throw new HttpError(403, "אפשר לפתוח קריאה רק על בית שלך");
    }
    if (actor.role === "patrol") throw new HttpError(403, "סייר לא פותח קריאות");
    const existing = q(db).get(
      `SELECT id FROM calls WHERE house_id = ? AND status != 'closed'`,
      house.id,
    );
    if (existing) throw new HttpError(409, "כבר יש קריאה פתוחה על הבית הזה");

    const at = nowIso();
    const note = notes?.trim() || null;
    const inserted = q(db).run(
      `INSERT INTO calls (house_id, status, opened_by, notes, opened_at)
       VALUES (?, 'new', ?, ?, ?)`,
      house.id,
      actor.id,
      note,
      at,
    );
    insertEvent(db, inserted.id, "new", actor.id, note, at, null, null);

    const matches = eligiblePatrols(db, house);
    const assignee = matches[0] ?? null;
    if (assignee) {
      q(db).run(`UPDATE calls SET assigned_patrol_id = ? WHERE id = ?`, assignee.id, inserted.id);
      insertEvent(db, inserted.id, "new", actor.id, `שויכה אל ${assignee.full_name}`, at, null, null);
    }

    const label = houseLabel(house);
    const body = [
      label,
      house.phone ? `טלפון ${house.phone}` : null,
      note,
      assignee ? `שויכה אל ${assignee.full_name}` : "אין סייר פעיל באזור",
    ]
      .filter(Boolean)
      .join(" · ");

    const recipients = matches.map((p) => p.id);
    if (!assignee) recipients.push(...staffIds(db, actor.id));
    if (actor.role === "authorized_user") recipients.push(...staffIds(db, actor.id));
    notify(db, recipients, {
      callId: inserted.id,
      title: assignee ? "קריאה חדשה" : "קריאה ללא סייר פעיל",
      body,
      at,
    });
    if (actor.role === "authorized_user") {
      notify(db, [actor.id], {
        callId: inserted.id,
        title: "הקריאה נפתחה",
        body: assignee ? `נשלחה אל ${assignee.full_name}` : "המוקד קיבל את הקריאה ומחפש סייר",
        at,
      });
    }

    const suggestions = recomputeSuggestions(db, actor.id);
    return {
      callId: inserted.id,
      assignedPatrolId: assignee?.id ?? null,
      assignedPatrolName: assignee?.full_name ?? null,
      notified: matches.length,
      polygonSuggested: suggestions.length > 0,
    };
  });
}

export function setStatus(db, actor, callId, status, opts = {}) {
  return tx(db, () => {
    if (!NEXT_STATUS[status] && status !== "closed" && !STATUS_LABEL[status]) {
      throw new HttpError(400, "סטטוס לא מוכר");
    }
    const call = callById(db, callId);
    if (!call) throw new HttpError(404, "הקריאה לא נמצאה");
    const allowed = NEXT_STATUS[call.status] ?? [];
    if (!allowed.includes(status)) throw new HttpError(400, "אי אפשר לעדכן לסטטוס הזה");

    const house = houseById(db, call.house_id);
    if (actor.role === "patrol") {
      const mine = call.assigned_patrol_id === actor.id;
      if (!mine) {
        if (call.assigned_patrol_id != null) throw new HttpError(403, "הקריאה משויכת לסייר אחר");
        const self = patrolRecord(db, actor.id);
        const match = eligiblePatrols(db, house).some((p) => p.id === actor.id);
        if (!self?.is_active || !match) throw new HttpError(403, "אי אפשר לקחת את הקריאה הזו");
        q(db).run(`UPDATE calls SET assigned_patrol_id = ? WHERE id = ?`, actor.id, call.id);
      }
    } else if (actor.role === "authorized_user") {
      throw new HttpError(403, "אין הרשאה לעדכן סטטוס");
    }

    const at = opts.at || nowIso();
    const sets = [`status = ?`];
    const params = [status];
    if (status === "en_route" || status === "arrived" || status === "closed") {
      if (!call.received_at) {
        sets.push("received_at = ?");
        params.push(at);
      }
    }
    const stamp = STAMP[status];
    sets.push(`${stamp} = ?`);
    params.push(at);
    params.push(call.id);
    q(db).run(`UPDATE calls SET ${sets.join(", ")} WHERE id = ?`, ...params);
    insertEvent(db, call.id, status, actor.id, opts.note?.trim() || null, at, opts.lat ?? null, opts.lng ?? null);

    const fresh = callById(db, call.id);
    const recipients = [
      ...staffIds(db, actor.id),
      fresh.assigned_patrol_id,
      fresh.opened_by,
    ].filter((id) => id && id !== actor.id);
    notify(db, recipients, {
      callId: call.id,
      title: `קריאה ${STATUS_LABEL[status]}`,
      body: `${houseLabel(house)} · ${actor.full_name}`,
      at,
    });
    recomputeSuggestions(db, actor.id);
    return { callId: call.id, status };
  });
}

export function assignCall(db, actor, callId, patrolId) {
  return tx(db, () => {
    const call = callById(db, callId);
    if (!call) throw new HttpError(404, "הקריאה לא נמצאה");
    if (call.status === "closed") throw new HttpError(400, "אי אפשר לשייך קריאה סגורה");
    const patrol = patrolRecord(db, patrolId);
    if (!patrol || !patrol.active) throw new HttpError(404, "הסייר לא נמצא");
    const at = nowIso();
    q(db).run(`UPDATE calls SET assigned_patrol_id = ? WHERE id = ?`, patrol.id, call.id);
    insertEvent(db, call.id, call.status, actor.id, `שויכה אל ${patrol.full_name}`, at, null, null);
    const house = houseById(db, call.house_id);
    notify(db, [patrol.id], {
      callId: call.id,
      title: "קריאה שויכה אליך",
      body: houseLabel(house),
      at,
    });
    return { callId: call.id, assignedPatrolId: patrol.id, assignedPatrolName: patrol.full_name };
  });
}

export function setPresence(db, actor, { active, lat, lng }) {
  if (actor.role !== "patrol") throw new HttpError(403, "רק סייר מסמן נוכחות");
  const at = nowIso();
  const existing = q(db).get(`SELECT user_id FROM patrol_profiles WHERE user_id = ?`, actor.id);
  if (!existing) {
    q(db).run(
      `INSERT INTO patrol_profiles (user_id, is_active, lat, lng, location_updated_at) VALUES (?, ?, ?, ?, ?)`,
      actor.id,
      active ? 1 : 0,
      lat ?? null,
      lng ?? null,
      lat != null ? at : null,
    );
  } else {
    const sets = ["is_active = ?"];
    const params = [active ? 1 : 0];
    if (lat != null && lng != null) {
      sets.push("lat = ?", "lng = ?", "location_updated_at = ?");
      params.push(lat, lng, at);
    }
    params.push(actor.id);
    q(db).run(`UPDATE patrol_profiles SET ${sets.join(", ")} WHERE user_id = ?`, ...params);
  }
  return patrolRecord(db, actor.id);
}

export function savePolygon(db, actor, { id, name, confirmed, callIds }) {
  return tx(db, () => {
    const ids = [...new Set((callIds ?? []).map(Number))];
    if (!ids.length) throw new HttpError(400, "צריך לבחור לפחות קריאה אחת");
    for (const callId of ids) {
      const call = callById(db, callId);
      if (!call || call.status === "closed") throw new HttpError(400, "אפשר לקשר רק קריאות פתוחות");
    }
    const at = nowIso();
    let polygonId = id ?? null;
    if (!polygonId) {
      const row = q(db).run(
        `INSERT INTO polygons (name, confirmed, radius_meters, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        name?.trim() || "פוליגון",
        confirmed ? 1 : 0,
        getSettings(db).polygonRadiusMeters,
        actor.id,
        at,
      );
      polygonId = row.id;
    } else {
      const current = q(db).get(`SELECT * FROM polygons WHERE id = ?`, polygonId);
      if (!current) throw new HttpError(404, "הפוליגון לא נמצא");
      q(db).run(
        `UPDATE polygons SET name = ?, confirmed = ? WHERE id = ?`,
        name?.trim() || current.name,
        confirmed ? 1 : 0,
        polygonId,
      );
      q(db).run(`DELETE FROM polygon_calls WHERE polygon_id = ?`, polygonId);
    }
    for (const callId of ids) {
      q(db).run(`DELETE FROM polygon_calls WHERE call_id = ?`, callId);
      q(db).run(
        `INSERT INTO polygon_calls (polygon_id, call_id) VALUES (?, ?)`,
        polygonId,
        callId,
      );
    }
    recomputeSuggestions(db, actor.id);
    return { polygonId };
  });
}

export function deletePolygon(db, actor, polygonId) {
  return tx(db, () => {
    const current = q(db).get(`SELECT * FROM polygons WHERE id = ?`, polygonId);
    if (!current) throw new HttpError(404, "הפוליגון לא נמצא");
    if (!current.confirmed) {
      const ids = q(db)
        .all(`SELECT call_id FROM polygon_calls WHERE polygon_id = ? ORDER BY call_id`, polygonId)
        .map((row) => row.call_id);
      q(db).run(
        `INSERT INTO suggestion_dismissals (signature, created_at) VALUES (?, ?)
         ON CONFLICT(signature) DO NOTHING`,
        ids.join(","),
        nowIso(),
      );
    }
    q(db).run(`DELETE FROM polygons WHERE id = ?`, polygonId);
    recomputeSuggestions(db, actor.id);
    return { polygonId };
  });
}

export function updateSettings(db, actor, { polygonRadiusMeters, gpsMatchMeters }) {
  if (polygonRadiusMeters != null) {
    q(db).run(
      `INSERT INTO settings (key, value) VALUES ('polygon_radius_meters', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      String(polygonRadiusMeters),
    );
  }
  if (gpsMatchMeters != null) {
    q(db).run(
      `INSERT INTO settings (key, value) VALUES ('gps_match_meters', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      String(gpsMatchMeters),
    );
  }
  recomputeSuggestions(db, actor.id);
  return getSettings(db);
}

function presentHouse(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    areaId: row.area_id,
    notes: row.notes,
    ownerUserId: row.owner_user_id,
  };
}

function presentShift(row) {
  return {
    id: row.id,
    name: row.name,
    areaId: row.area_id,
    startTime: row.start_time,
    endTime: row.end_time,
    days: JSON.parse(row.days),
    active: !!row.active,
  };
}

function presentArea(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    centerLat: row.center_lat,
    centerLng: row.center_lng,
    radiusMeters: row.radius_meters,
  };
}

export function buildState(db, viewer) {
  const areas = q(db).all(`SELECT * FROM areas ORDER BY name`).map(presentArea);
  const shifts = q(db).all(`SELECT * FROM shifts ORDER BY id`).map(presentShift);
  const houses = q(db)
    .all(`SELECT * FROM houses WHERE archived = 0 ORDER BY name`)
    .map(presentHouse);
  const callsRaw = q(db).all(`SELECT * FROM calls ORDER BY opened_at DESC`);
  const events = q(db).all(`SELECT * FROM call_events ORDER BY created_at ASC, id ASC`);
  const users = q(db).all(
    `SELECT id, full_name, phone, email, role, active FROM users ORDER BY full_name`,
  );
  const userName = new Map(users.map((u) => [u.id, u.full_name]));
  const eventsByCall = new Map();
  for (const event of events) {
    if (!eventsByCall.has(event.call_id)) eventsByCall.set(event.call_id, []);
    eventsByCall.get(event.call_id).push({
      id: event.id,
      status: event.status,
      actorId: event.actor_id,
      actorName: userName.get(event.actor_id) ?? "",
      note: event.note,
      lat: event.lat,
      lng: event.lng,
      createdAt: event.created_at,
    });
  }
  const houseMap = new Map(houses.map((h) => [h.id, h]));
  const archivedHouses = q(db).all(`SELECT * FROM houses WHERE archived = 1`).map(presentHouse);
  for (const house of archivedHouses) houseMap.set(house.id, house);

  let visibleCalls = callsRaw;
  let visibleHouses = houses;
  if (viewer.role === "authorized_user") {
    const owned = new Set(houses.filter((h) => h.ownerUserId === viewer.id).map((h) => h.id));
    visibleHouses = houses.filter((h) => owned.has(h.id));
    visibleCalls = callsRaw.filter((c) => c.opened_by === viewer.id || owned.has(c.house_id));
  } else if (viewer.role === "patrol") {
    const self = patrolRecord(db, viewer.id);
    const areaIds = new Set(self?.areaIds ?? []);
    visibleHouses = houses.filter((h) => h.areaId != null && areaIds.has(h.areaId));
    const houseIds = new Set(visibleHouses.map((h) => h.id));
    visibleCalls = callsRaw.filter(
      (c) => c.assigned_patrol_id === viewer.id || houseIds.has(c.house_id),
    );
    const extraHouseIds = visibleCalls.map((c) => c.house_id);
    const have = new Set(visibleHouses.map((h) => h.id));
    for (const id of extraHouseIds) {
      if (!have.has(id) && houseMap.get(id)) visibleHouses.push(houseMap.get(id));
    }
  }

  const calls = visibleCalls.map((c) => ({
    id: c.id,
    houseId: c.house_id,
    status: c.status,
    statusLabel: STATUS_LABEL[c.status],
    openedBy: c.opened_by,
    openerName: userName.get(c.opened_by) ?? "",
    assignedPatrolId: c.assigned_patrol_id,
    assigneeName: c.assigned_patrol_id ? userName.get(c.assigned_patrol_id) ?? "" : null,
    notes: c.notes,
    openedAt: c.opened_at,
    receivedAt: c.received_at,
    enRouteAt: c.en_route_at,
    arrivedAt: c.arrived_at,
    closedAt: c.closed_at,
    house: houseMap.get(c.house_id) ?? null,
    events: eventsByCall.get(c.id) ?? [],
  }));

  const callIds = new Set(calls.map((c) => c.id));
  const polygonRows = q(db).all(`SELECT * FROM polygons ORDER BY id DESC`);
  const links = q(db).all(`SELECT polygon_id, call_id FROM polygon_calls`);
  const linksByPolygon = new Map();
  for (const link of links) {
    if (!linksByPolygon.has(link.polygon_id)) linksByPolygon.set(link.polygon_id, []);
    linksByPolygon.get(link.polygon_id).push(link.call_id);
  }
  let polygons = polygonRows.map((p) => ({
    id: p.id,
    name: p.name,
    confirmed: !!p.confirmed,
    radiusMeters: p.radius_meters,
    createdAt: p.created_at,
    callIds: linksByPolygon.get(p.id) ?? [],
  }));
  if (viewer.role === "patrol" || viewer.role === "authorized_user") {
    polygons = polygons.filter((p) => p.callIds.some((id) => callIds.has(id)));
    polygons = polygons.map((p) => ({ ...p, callIds: p.callIds.filter((id) => callIds.has(id)) }));
  }

  const patrols = listPatrolRecords(db)
    .filter((p) => viewer.role === "admin" || viewer.role === "dispatcher" || p.id === viewer.id)
    .map((p) => ({
      id: p.id,
      fullName: p.full_name,
      phone: p.phone,
      email: viewer.role === "admin" ? p.email : undefined,
      accountActive: !!p.active,
      isActive: !!p.is_active,
      lat: p.lat,
      lng: p.lng,
      locationUpdatedAt: p.location_updated_at,
      shiftId: p.shift_id,
      onShift: p.onShift,
      areaIds: p.areaIds,
      shiftName: p.shift?.name ?? null,
    }));

  const self = viewer.role === "patrol" ? patrolRecord(db, viewer.id) : null;
  const notifications = q(db)
    .all(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40`,
      viewer.id,
    )
    .map((n) => ({
      id: n.id,
      callId: n.call_id,
      title: n.title,
      body: n.body,
      read: !!n.read,
      createdAt: n.created_at,
    }));

  const directory =
    viewer.role === "admin"
      ? users.map((u) => ({
          id: u.id,
          fullName: u.full_name,
          phone: u.phone,
          email: u.email,
          role: u.role,
          active: !!u.active,
          areaIds: u.role === "patrol" ? patrolRecord(db, u.id)?.areaIds ?? [] : [],
          shiftId: u.role === "patrol" ? patrolRecord(db, u.id)?.shift_id ?? null : null,
        }))
      : [];

  return {
    me: {
      id: viewer.id,
      email: viewer.email,
      fullName: viewer.full_name,
      phone: viewer.phone,
      role: viewer.role,
      isActive: self ? !!self.is_active : null,
      onShift: self ? self.onShift : null,
      shiftName: self?.shift?.name ?? null,
      shiftId: self?.shift_id ?? null,
      areaIds: self?.areaIds ?? [],
      lat: self?.lat ?? null,
      lng: self?.lng ?? null,
    },
    settings: getSettings(db),
    areas,
    shifts,
    houses: visibleHouses,
    calls,
    polygons,
    patrols,
    users: directory,
    notifications,
    serverTime: nowIso(),
  };
}

export function markNotificationsRead(db, userId, ids) {
  if (!ids?.length) {
    q(db).run(`UPDATE notifications SET read = 1 WHERE user_id = ?`, userId);
    return;
  }
  for (const id of ids) {
    q(db).run(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?`, userId, id);
  }
}

const ROLES = new Set(["admin", "dispatcher", "patrol", "authorized_user"]);

export function createUser(db, input) {
  if (!ROLES.has(input.role)) throw new HttpError(400, "תפקיד לא תקין");
  const at = nowIso();
  let row;
  try {
    row = q(db).run(
      `INSERT INTO users (email, password_hash, full_name, phone, role, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      input.email,
      input.passwordHash,
      input.fullName,
      input.phone,
      input.role,
      at,
    );
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) throw new HttpError(400, "האימייל כבר קיים");
    throw error;
  }
  syncPatrol(db, row.id, input);
  return row.id;
}

export function updateUser(db, actor, userId, input) {
  const current = userById(db, userId);
  if (!current) throw new HttpError(404, "המשתמש לא נמצא");
  if (input.role && !ROLES.has(input.role)) throw new HttpError(400, "תפקיד לא תקין");
  const nextRole = input.role || current.role;
  const nextActive = input.active == null ? current.active : input.active ? 1 : 0;
  if (current.role === "admin" && current.active && (nextRole !== "admin" || !nextActive)) {
    const others = q(db).get(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?`,
      current.id,
    );
    if (!others.n) throw new HttpError(400, "חייב להישאר לפחות מנהל מערכת פעיל אחד");
  }
  try {
    q(db).run(
      `UPDATE users SET full_name = ?, phone = ?, role = ?, active = ?, email = ? WHERE id = ?`,
      input.fullName ?? current.full_name,
      input.phone === undefined ? current.phone : input.phone,
      nextRole,
      nextActive,
      input.email ?? current.email,
      current.id,
    );
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) throw new HttpError(400, "האימייל כבר קיים");
    throw error;
  }
  if (input.passwordHash) {
    q(db).run(`UPDATE users SET password_hash = ? WHERE id = ?`, input.passwordHash, current.id);
  }
  syncPatrol(db, current.id, { ...input, role: nextRole });
  return current.id;
}

function syncPatrol(db, userId, input) {
  if (input.role !== "patrol") return;
  if (input.shiftId) {
    const shift = q(db).get(`SELECT id FROM shifts WHERE id = ?`, input.shiftId);
    if (!shift) throw new HttpError(400, "משמרת לא נמצאה");
  }
  const existing = q(db).get(`SELECT user_id FROM patrol_profiles WHERE user_id = ?`, userId);
  if (!existing) {
    q(db).run(
      `INSERT INTO patrol_profiles (user_id, is_active, shift_id) VALUES (?, 0, ?)`,
      userId,
      input.shiftId ?? null,
    );
  } else if (input.shiftId !== undefined) {
    q(db).run(`UPDATE patrol_profiles SET shift_id = ? WHERE user_id = ?`, input.shiftId, userId);
  }
  if (input.areaIds) {
    q(db).run(`DELETE FROM patrol_areas WHERE user_id = ?`, userId);
    for (const areaId of input.areaIds) {
      const area = q(db).get(`SELECT id FROM areas WHERE id = ?`, areaId);
      if (!area) throw new HttpError(400, "אזור לא נמצא");
      q(db).run(`INSERT INTO patrol_areas (user_id, area_id) VALUES (?, ?)`, userId, areaId);
    }
  }
}

export function saveArea(db, input) {
  const at = nowIso();
  if (!input.id) {
    try {
      return q(db).run(
        `INSERT INTO areas (name, description, color, center_lat, center_lng, radius_meters, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        input.name,
        input.description,
        input.color,
        input.centerLat,
        input.centerLng,
        input.radiusMeters,
        at,
      ).id;
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new HttpError(400, "שם האזור כבר קיים");
      throw error;
    }
  }
  const current = q(db).get(`SELECT * FROM areas WHERE id = ?`, input.id);
  if (!current) throw new HttpError(404, "האזור לא נמצא");
  try {
    q(db).run(
      `UPDATE areas SET name = ?, description = ?, color = ?, center_lat = ?, center_lng = ?, radius_meters = ? WHERE id = ?`,
      input.name,
      input.description,
      input.color,
      input.centerLat,
      input.centerLng,
      input.radiusMeters,
      input.id,
    );
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) throw new HttpError(400, "שם האזור כבר קיים");
    throw error;
  }
  return input.id;
}

export function deleteArea(db, id) {
  const used = q(db).get(`SELECT COUNT(*) AS n FROM houses WHERE area_id = ? AND archived = 0`, id);
  if (used.n) throw new HttpError(400, "יש בתים משויכים לאזור. העבירו אותם לפני המחיקה");
  const row = q(db).run(`DELETE FROM areas WHERE id = ?`, id);
  if (!row.changes) throw new HttpError(404, "האזור לא נמצא");
}

export function saveHouse(db, input) {
  if (input.areaId) {
    const area = q(db).get(`SELECT id FROM areas WHERE id = ?`, input.areaId);
    if (!area) throw new HttpError(400, "אזור לא נמצא");
  }
  if (input.ownerUserId) {
    const owner = q(db).get(
      `SELECT id, role FROM users WHERE id = ? AND active = 1`,
      input.ownerUserId,
    );
    if (!owner || owner.role !== "authorized_user") {
      throw new HttpError(400, "הבעלים צריך להיות משתמש מורשה פעיל");
    }
  }
  const at = nowIso();
  if (!input.id) {
    return q(db).run(
      `INSERT INTO houses (name, phone, address, lat, lng, area_id, notes, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.name,
      input.phone,
      input.address,
      input.lat,
      input.lng,
      input.areaId,
      input.notes,
      input.ownerUserId,
      at,
      at,
    ).id;
  }
  const current = houseById(db, input.id);
  if (!current || current.archived) throw new HttpError(404, "הבית לא נמצא");
  q(db).run(
    `UPDATE houses SET name = ?, phone = ?, address = ?, lat = ?, lng = ?, area_id = ?, notes = ?, owner_user_id = ?, updated_at = ? WHERE id = ?`,
    input.name,
    input.phone,
    input.address,
    input.lat,
    input.lng,
    input.areaId,
    input.notes,
    input.ownerUserId,
    at,
    input.id,
  );
  return input.id;
}

export function archiveHouse(db, id) {
  const open = q(db).get(
    `SELECT COUNT(*) AS n FROM calls WHERE house_id = ? AND status != 'closed'`,
    id,
  );
  if (open.n) throw new HttpError(400, "יש קריאה פתוחה על הבית");
  const row = q(db).run(
    `UPDATE houses SET archived = 1, updated_at = ? WHERE id = ? AND archived = 0`,
    nowIso(),
    id,
  );
  if (!row.changes) throw new HttpError(404, "הבית לא נמצא");
}

export function saveShift(db, input) {
  const days = JSON.stringify(input.days);
  if (!input.id) {
    return q(db).run(
      `INSERT INTO shifts (name, area_id, start_time, end_time, days, active) VALUES (?, ?, ?, ?, ?, ?)`,
      input.name,
      input.areaId,
      input.startTime,
      input.endTime,
      days,
      input.active ? 1 : 0,
    ).id;
  }
  const current = q(db).get(`SELECT id FROM shifts WHERE id = ?`, input.id);
  if (!current) throw new HttpError(404, "המשמרת לא נמצאה");
  q(db).run(
    `UPDATE shifts SET name = ?, area_id = ?, start_time = ?, end_time = ?, days = ?, active = ? WHERE id = ?`,
    input.name,
    input.areaId,
    input.startTime,
    input.endTime,
    days,
    input.active ? 1 : 0,
    input.id,
  );
  return input.id;
}

export function deleteShift(db, id) {
  q(db).run(`UPDATE patrol_profiles SET shift_id = NULL WHERE shift_id = ?`, id);
  const row = q(db).run(`DELETE FROM shifts WHERE id = ?`, id);
  if (!row.changes) throw new HttpError(404, "המשמרת לא נמצאה");
}

export function importHouses(db, rows) {
  return tx(db, () => {
    const result = { created: 0, skipped: 0, errors: [] };
    let colorIndex = q(db).get(`SELECT COUNT(*) AS n FROM areas`).n;
    rows.forEach((row, index) => {
      const line = index + 2;
      try {
        if (!row.name) throw new Error("חסר שם");
        if (row.name.length > 120) throw new Error("השם ארוך מדי");
        if (Number.isNaN(row.lat) || Number.isNaN(row.lng)) throw new Error("קואורדינטה לא תקינה");
        if ((row.lat == null) !== (row.lng == null)) {
          throw new Error("קו רוחב וקו אורך חייבים להופיע יחד");
        }
        if (row.lat != null && (row.lat < -90 || row.lat > 90 || row.lng < -180 || row.lng > 180)) {
          throw new Error("קואורדינטה מחוץ לטווח");
        }
        let areaId = null;
        if (row.area) {
          let area = q(db).get(`SELECT id FROM areas WHERE name = ?`, row.area);
          if (!area) {
            const id = saveArea(db, {
              name: row.area,
              description: "נוצר בייבוא",
              color: AREA_COLORS[colorIndex % AREA_COLORS.length],
              centerLat: row.lat,
              centerLng: row.lng,
              radiusMeters: 2500,
            });
            colorIndex += 1;
            area = { id };
          }
          areaId = area.id;
        }
        let ownerUserId = null;
        if (row.ownerEmail) {
          const owner = q(db).get(
            `SELECT id, role FROM users WHERE email = ?`,
            String(row.ownerEmail).trim().toLowerCase(),
          );
          if (!owner || owner.role !== "authorized_user") {
            throw new Error("אימייל הבעלים אינו משתמש מורשה");
          }
          ownerUserId = owner.id;
        }
        saveHouse(db, {
          name: row.name,
          phone: row.phone || null,
          address: row.address || null,
          lat: row.lat,
          lng: row.lng,
          areaId,
          notes: row.notes || null,
          ownerUserId,
        });
        result.created += 1;
      } catch (error) {
        result.skipped += 1;
        result.errors.push({ line, message: error.message || "שורה לא תקינה" });
      }
    });
    return result;
  });
}

function minutesBetween(a, b) {
  if (!a || !b) return null;
  return (new Date(b).getTime() - new Date(a).getTime()) / 60000;
}

function average(values) {
  const nums = values.filter((v) => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10;
}

export function buildReport(db, filters) {
  const from = filters.from || new Date(Date.now() - 30 * 86400000).toISOString();
  const to = filters.to || new Date().toISOString();
  let calls = q(db).all(
    `SELECT c.*, h.name AS house_name, h.address, h.area_id, a.name AS area_name,
            opener.full_name AS opener_name, patrol.full_name AS patrol_name
     FROM calls c
     JOIN houses h ON h.id = c.house_id
     LEFT JOIN areas a ON a.id = h.area_id
     JOIN users opener ON opener.id = c.opened_by
     LEFT JOIN users patrol ON patrol.id = c.assigned_patrol_id
     WHERE c.opened_at >= ? AND c.opened_at <= ?
     ORDER BY c.opened_at DESC`,
    from,
    to,
  );
  if (filters.areaId) calls = calls.filter((c) => c.area_id === filters.areaId);
  if (filters.patrolId) calls = calls.filter((c) => c.assigned_patrol_id === filters.patrolId);
  if (filters.status) calls = calls.filter((c) => c.status === filters.status);

  const byStatus = {};
  for (const key of Object.keys(STATUS_LABEL)) byStatus[key] = 0;
  const byDayMap = new Map();
  const byArea = new Map();
  const byPatrol = new Map();
  for (const call of calls) {
    byStatus[call.status] = (byStatus[call.status] ?? 0) + 1;
    const day = jerusalemDate(call.opened_at);
    byDayMap.set(day, (byDayMap.get(day) ?? 0) + 1);
    const area = call.area_name || "ללא אזור";
    byArea.set(area, (byArea.get(area) ?? 0) + 1);
    const patrol = call.patrol_name || "לא שובץ";
    byPatrol.set(patrol, (byPatrol.get(patrol) ?? 0) + 1);
  }

  const rows = calls.map((c) => ({
    id: c.id,
    openedAt: c.opened_at,
    status: c.status,
    statusLabel: STATUS_LABEL[c.status],
    house: c.house_name,
    address: c.address,
    area: c.area_name,
    opener: c.opener_name,
    patrol: c.patrol_name,
    notes: c.notes,
    receivedAt: c.received_at,
    arrivedAt: c.arrived_at,
    closedAt: c.closed_at,
    minutesToReceive: minutesBetween(c.opened_at, c.received_at),
    minutesToArrive: minutesBetween(c.opened_at, c.arrived_at),
    minutesToClose: minutesBetween(c.opened_at, c.closed_at),
  }));

  return {
    from,
    to,
    total: rows.length,
    byStatus,
    byDay: [...byDayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    byArea: [...byArea.entries()].map(([name, count]) => ({ name, count })),
    byPatrol: [...byPatrol.entries()].map(([name, count]) => ({ name, count })),
    avgMinutesToReceive: average(rows.map((r) => r.minutesToReceive)),
    avgMinutesToArrive: average(rows.map((r) => r.minutesToArrive)),
    avgMinutesToClose: average(rows.map((r) => r.minutesToClose)),
    rows,
  };
}

export function reportToCsv(report) {
  const headers = [
    "מספר",
    "נפתחה",
    "סטטוס",
    "בית",
    "כתובת",
    "אזור",
    "פתח",
    "סייר",
    "הערות",
    "דקות עד קבלה",
    "דקות עד הגעה",
    "דקות עד סגירה",
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of report.rows) {
    lines.push(
      [
        row.id,
        row.openedAt,
        row.statusLabel,
        row.house,
        row.address,
        row.area,
        row.opener,
        row.patrol,
        row.notes,
        row.minutesToReceive,
        row.minutesToArrive,
        row.minutesToClose,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\n")}`;
}

function csvCell(value) {
  const raw = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    role: row.role,
  };
}
