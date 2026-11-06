import * as XLSX from "xlsx";
import { HttpError } from "./http.mjs";

const ALIASES = {
  name: ["name", "שם", "שם בית", "שם הבית", "house"],
  phone: ["phone", "טלפון", "נייד", "טל"],
  address: ["address", "כתובת"],
  lat: ["lat", "latitude", "קו רוחב", "קו_רוחב"],
  lng: ["lng", "lon", "long", "longitude", "קו אורך", "קו_אורך"],
  area: ["area", "אזור"],
  notes: ["notes", "הערות", "הערה"],
  ownerEmail: ["owner", "owner_email", "owner email", "אימייל בעלים", "בעלים", "אימייל"],
};

function norm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function cell(line, index) {
  if (index == null) return "";
  return String(line[index] ?? "").trim();
}

function num(line, index) {
  if (index == null) return null;
  const raw = line[index];
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
}

export function rowsFromMatrix(matrix) {
  if (!matrix?.length) throw new HttpError(400, "הקובץ ריק");
  const header = matrix[0].map(norm);
  const index = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const found = header.findIndex((value) => aliases.includes(value));
    if (found >= 0) index[field] = found;
  }
  if (index.name == null) throw new HttpError(400, "חסרה עמודת שם");
  const rows = [];
  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i] || [];
    if (line.every((value) => value == null || String(value).trim() === "")) continue;
    const lat = num(line, index.lat);
    const lng = num(line, index.lng);
    rows.push({
      name: cell(line, index.name),
      phone: cell(line, index.phone),
      address: cell(line, index.address),
      lat: Number.isNaN(lat) ? null : lat,
      lng: Number.isNaN(lng) ? null : lng,
      area: cell(line, index.area),
      notes: cell(line, index.notes),
      ownerEmail: cell(line, index.ownerEmail),
      badCoord: Number.isNaN(lat) || Number.isNaN(lng),
    });
  }
  if (!rows.length) throw new HttpError(400, "אין שורות לייבוא");
  if (rows.length > 2000) throw new HttpError(400, "אפשר לייבא עד 2000 שורות בכל פעם");
  return rows.map((row) => {
    if (row.badCoord) return { ...row, lat: Number.NaN, lng: Number.NaN };
    return row;
  });
}

export function rowsFromWorkbook(buffer) {
  const book = XLSX.read(buffer, { type: "buffer" });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new HttpError(400, "הקובץ לא מכיל גיליון");
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  return rowsFromMatrix(matrix);
}

export function houseTemplateBuffer() {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["שם", "טלפון", "כתובת", "קו רוחב", "קו אורך", "אזור", "הערות", "אימייל בעלים"],
    ["בית משפחת לדוגמה", "050-0000000", "הרצל 1", 32.0853, 34.7818, "שכונת הדר", "שער כחול", ""],
  ]);
  sheet["!cols"] = [22, 16, 24, 14, 14, 16, 24, 28].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(book, sheet, "בתים");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}
