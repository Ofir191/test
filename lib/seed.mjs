import { hashPassword } from "./auth.mjs";
import { q, tx } from "./db.mjs";
import { openCall, setStatus } from "./domain.mjs";
import { shiftCovers } from "./time.mjs";

const DAYS = JSON.stringify([0, 1, 2, 3, 4, 5, 6]);

export function seedDemo(db) {
  tx(db, () => seedDemoInner(db));
}

function seedDemoInner(db) {
  const at = new Date().toISOString();
  const addUser = (email, password, fullName, phone, role) =>
    q(db).run(
      `INSERT INTO users (email, password_hash, full_name, phone, role, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      email,
      hashPassword(password),
      fullName,
      phone,
      role,
      at,
    ).id;

  addUser("admin@mishmar.local", "Admin1234", "דנה כהן", "050-1000001", "admin");
  const dispatchId = addUser("dispatch@mishmar.local", "Dispatch1234", "יוסי לוי", "050-1000002", "dispatcher");
  const aviId = addUser("avi@mishmar.local", "Patrol1234", "אבי מזרחי", "050-1000003", "patrol");
  const michalId = addUser("michal@mishmar.local", "Patrol1234", "מיכל אברהם", "050-1000004", "patrol");
  const ronitId = addUser("ronit@mishmar.local", "Resident1234", "רונית שמש", "050-1000005", "authorized_user");

  q(db).run(`INSERT INTO settings (key, value) VALUES ('polygon_radius_meters', '500')`);
  q(db).run(`INSERT INTO settings (key, value) VALUES ('gps_match_meters', '3000')`);

  const addArea = (name, description, color, lat, lng) =>
    q(db).run(
      `INSERT INTO areas (name, description, color, center_lat, center_lng, radius_meters, created_at)
       VALUES (?, ?, ?, ?, ?, 1800, ?)`,
      name,
      description,
      color,
      lat,
      lng,
      at,
    ).id;

  const north = addArea("רמת האורנים", "שכונה צפונית, בתים צמודי קרקע", "#3dcaa0", 32.0955, 34.786);
  const center = addArea("שכונת הדר", "ציר ויצמן והרחובות סביבו", "#4aa3ff", 32.0805, 34.7802);
  const south = addArea("נווה דקל", "שכונה דרומית", "#e8a838", 32.0655, 34.775);

  const shiftDefs = [
    { name: "בוקר", start: "06:00", end: "15:00" },
    { name: "ערב", start: "15:00", end: "23:00" },
    { name: "לילה", start: "23:00", end: "06:00" },
  ];
  const shifts = shiftDefs.map((shift) => ({
    ...shift,
    id: q(db).run(
      `INSERT INTO shifts (name, area_id, start_time, end_time, days, active) VALUES (?, NULL, ?, ?, ?, 1)`,
      shift.name,
      shift.start,
      shift.end,
      DAYS,
    ).id,
  }));
  const covering = shifts.find((shift) =>
    shiftCovers({ active: 1, days: JSON.parse(DAYS), start_time: shift.start, end_time: shift.end }),
  );
  const aviShift = covering ?? shifts[0];
  const michalShift = shifts.find((shift) => shift.id !== aviShift.id) ?? shifts[0];

  q(db).run(
    `INSERT INTO patrol_profiles (user_id, is_active, lat, lng, location_updated_at, shift_id)
     VALUES (?, 1, 32.0956, 34.7864, ?, ?)`,
    aviId,
    at,
    aviShift.id,
  );
  q(db).run(
    `INSERT INTO patrol_profiles (user_id, is_active, lat, lng, location_updated_at, shift_id)
     VALUES (?, 0, 32.0658, 34.7756, ?, ?)`,
    michalId,
    at,
    michalShift.id,
  );
  for (const areaId of [north, center]) {
    q(db).run(`INSERT INTO patrol_areas (user_id, area_id) VALUES (?, ?)`, aviId, areaId);
  }
  q(db).run(`INSERT INTO patrol_areas (user_id, area_id) VALUES (?, ?)`, michalId, south);

  const addHouse = (name, phone, address, lat, lng, areaId, notes, ownerId = null) =>
    q(db).run(
      `INSERT INTO houses (name, phone, address, lat, lng, area_id, notes, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      name,
      phone,
      address,
      lat,
      lng,
      areaId,
      notes,
      ownerId,
      at,
      at,
    ).id;

  const shemesh = addHouse("בית משפחת שמש", "050-2000001", "הרצל 12", 32.0962, 34.7861, north, "שער כחול, פעמון בצד ימין", ronitId);
  const azulay = addHouse("בית משפחת אזולאי", "050-2000002", "הרצל 18", 32.0968, 34.7874, north, "קומה 2, דירה 5");
  addHouse("גן ילדים האורנים", "050-2000003", "הבנים 4", 32.0975, 34.7848, north, "כניסה מחצר המשחקים");
  addHouse("בית משפחת מזרחי", "050-2000004", "הזית 9", 32.0944, 34.7892, north, null);
  addHouse("מחסן קהילתי", "050-2000005", "אלון 2", 32.0938, 34.7835, north, "מפתח אצל השכן מול");
  const levi = addHouse("בית משפחת לוי", "050-2000006", "ויצמן 21", 32.0804, 34.7802, center, "כלב בחצר, לא תוקפני");
  addHouse("בית משפחת פרץ", "050-2000007", "ויצמן 27", 32.081, 34.7815, center, null);
  const synagogue = addHouse("בית כנסת הדר", "03-5551212", "נורדאו 5", 32.0792, 34.7788, center, "גבאי: משה");
  addHouse("בית משפחת ביטון", "050-2000009", "סוקולוב 14", 32.0822, 34.7794, center, null);
  addHouse("דירת שמש", "050-2000001", "ביאליק 3", 32.0788, 34.7826, center, "דירת נופש בקומה 1", ronitId);
  const hadad = addHouse("בית משפחת חדד", "050-2000011", "הדקל 8", 32.0655, 34.7755, south, null);
  addHouse("בית משפחת עמר", "050-2000012", "הדקל 15", 32.0661, 34.7768, south, null);
  addHouse("מועדון נוער", "050-2000013", "תמר 1", 32.0642, 34.7742, south, "כניסה אחורית נעולה בלילה");
  addHouse("בית משפחת גבאי", "050-2000014", "רימון 6", 32.067, 34.7735, south, null);

  const dispatcher = q(db).get(`SELECT * FROM users WHERE id = ?`, dispatchId);
  const ronit = q(db).get(`SELECT * FROM users WHERE id = ?`, ronitId);
  const avi = q(db).get(`SELECT * FROM users WHERE id = ?`, aviId);

  const closed = openCall(db, dispatcher, { houseId: synagogue, notes: "בדיקת נעילה אחרי אירוע" });
  const base = Date.now() - 26 * 60 * 60 * 1000;
  const atMin = (minutes) => new Date(base + minutes * 60000).toISOString();
  setStatus(db, avi, closed.callId, "received", { at: atMin(4) });
  setStatus(db, avi, closed.callId, "en_route", { at: atMin(6) });
  setStatus(db, avi, closed.callId, "arrived", { at: atMin(14) });
  setStatus(db, avi, closed.callId, "closed", { at: atMin(22), note: "נבדק, אין ממצא חריג" });
  q(db).run(`UPDATE calls SET opened_at = ? WHERE id = ?`, atMin(0), closed.callId);
  q(db).run(
    `UPDATE call_events SET created_at = ? WHERE call_id = ? AND status = 'new'`,
    atMin(0),
    closed.callId,
  );

  const enRoute = openCall(db, dispatcher, { houseId: levi, notes: "דיווח על רעש בחצר" });
  setStatus(db, avi, enRoute.callId, "received");
  setStatus(db, avi, enRoute.callId, "en_route");

  openCall(db, ronit, { houseId: shemesh, notes: "רכב לא מוכר חונה מול השער" });
  openCall(db, dispatcher, { houseId: azulay, notes: "שכן מדווח על תנועה בחצר" });
  openCall(db, dispatcher, { houseId: hadad, notes: "דלת אחורית פתוחה" });
}
