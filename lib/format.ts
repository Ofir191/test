import type { CallStatus } from "./types";

const WHEN = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const CLOCK = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

function ltr(value: string) {
  return `\u2066${value}\u2069`;
}

export function formatWhen(iso?: string | null) {
  if (!iso) return "—";
  return ltr(WHEN.format(new Date(iso)));
}

export function formatClock(date = new Date()) {
  return ltr(CLOCK.format(date));
}

export function todayInputValue() {
  return DAY.format(new Date());
}

export function daysAgoInputValue(days: number) {
  return DAY.format(new Date(Date.now() - days * 86400000));
}

export function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} מ׳`;
  return `${(meters / 1000).toFixed(1)} ק״מ`;
}

export function formatMinutes(value: number | null) {
  if (value == null) return "—";
  if (value < 1) return "פחות מדקה";
  return `${value} דק׳`;
}

export function statusClass(status: CallStatus | string) {
  return `st st-${status}`;
}

export function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function wazeLink(lat: number, lng: number) {
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
}
