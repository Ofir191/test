const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function jerusalemParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return {
    dow: WEEKDAY[get("weekday")] ?? 0,
    minutes: hour * 60 + minute,
  };
}

export function jerusalemDate(date) {
  const value = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function shiftCovers(shift, date = new Date()) {
  if (!shift || shift.active === 0 || shift.active === false) return false;
  let days = shift.days;
  if (typeof days === "string") {
    try {
      days = JSON.parse(days);
    } catch {
      return false;
    }
  }
  const { dow, minutes } = jerusalemParts(date);
  if (!Array.isArray(days) || !days.map(Number).includes(dow)) return false;
  const [sh, sm] = String(shift.start_time ?? shift.startTime).split(":").map(Number);
  const [eh, em] = String(shift.end_time ?? shift.endTime).split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  if (start === end) return true;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

export function nowIso() {
  return new Date().toISOString();
}

export function jerusalemOffset(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date);
  const tz = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+2";
  const match = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return "+02:00";
  return `${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}`;
}

export function jerusalemDayStart(day) {
  const offset = jerusalemOffset(new Date(`${day}T12:00:00Z`));
  return new Date(`${day}T00:00:00${offset}`).toISOString();
}

export function jerusalemDayEnd(day) {
  const offset = jerusalemOffset(new Date(`${day}T12:00:00Z`));
  return new Date(`${day}T23:59:59${offset}`).toISOString();
}
