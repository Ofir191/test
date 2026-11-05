import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import { resetDbForTests } from "../lib/db.mjs";
import { handleApi } from "../lib/router.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mishmar-"));
process.env.MISHMAR_DB = path.join(dir, "test.db");
process.env.SESSION_SECRET = "test-secret-test-secret";
resetDbForTests();

function jar() {
  const store = new Map();
  return {
    get(name) {
      return store.has(name) ? { name, value: store.get(name) } : undefined;
    },
    set(name, value) {
      store.set(name, value);
    },
    delete(name) {
      store.delete(name);
    },
  };
}

async function call(cookie, method, pathname, body) {
  const req = new Request(`http://localhost/api${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleApi(req, pathname.split("/").filter(Boolean), cookie);
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : await res.text();
  return { status: res.status, data };
}

async function login(email, password = "Patrol1234") {
  const cookie = jar();
  const res = await call(cookie, "POST", "/login", { email, password });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return cookie;
}

test("demo dispatch sees a suggested polygon and an unassigned southern call", async () => {
  const cookie = await login("dispatch@mishmar.local", "Dispatch1234");
  const state = await call(cookie, "GET", "/state");
  assert.equal(state.status, 200);
  assert.ok(state.data.polygons.some((polygon) => !polygon.confirmed && polygon.callIds.length >= 2));
  const south = state.data.calls.find((call) => call.house?.address === "הדקל 8");
  assert.ok(south);
  assert.equal(south.status, "new");
  assert.equal(south.assignedPatrolId, null);
  const near = state.data.calls.filter((call) =>
    ["הרצל 12", "הרצל 18"].includes(call.house?.address) && call.status !== "closed",
  );
  assert.equal(near.length, 2);
  assert.ok(near.every((call) => call.assigneeName === "אבי מזרחי"));
});

test("an authorized resident can open a call only on their own house", async () => {
  const cookie = await login("ronit@mishmar.local", "Resident1234");
  const state = await call(cookie, "GET", "/state");
  assert.equal(state.data.houses.length, 2);
  assert.equal(state.data.patrols.length, 0);
  const other = state.data.houses.find((house) => house.address === "ביאליק 3");
  const ownedOpen = await call(cookie, "POST", "/calls", { houseId: other.id, notes: "חלון פתוח" });
  assert.equal(ownedOpen.status, 200, JSON.stringify(ownedOpen.data));
  assert.equal(ownedOpen.data.assignedPatrolName, "אבי מזרחי");

  const dispatch = await login("dispatch@mishmar.local", "Dispatch1234");
  const all = await call(dispatch, "GET", "/state");
  const foreign = all.data.houses.find((house) => house.address === "ויצמן 27");
  const denied = await call(cookie, "POST", "/calls", { houseId: foreign.id, notes: "לא שלי" });
  assert.equal(denied.status, 403);
});

test("the assigned patrol advances a call and a stranger cannot", async () => {
  const dispatch = await login("dispatch@mishmar.local", "Dispatch1234");
  const before = await call(dispatch, "GET", "/state");
  const callRow = before.data.calls.find((item) => item.house?.address === "ויצמן 21");
  assert.equal(callRow.status, "en_route");

  const michal = await login("michal@mishmar.local");
  const blocked = await call(michal, "POST", `/calls/${callRow.id}/status`, { status: "arrived" });
  assert.equal(blocked.status, 403);

  const avi = await login("avi@mishmar.local");
  const arrived = await call(avi, "POST", `/calls/${callRow.id}/status`, { status: "arrived", note: "בפתח" });
  assert.equal(arrived.status, 200, JSON.stringify(arrived.data));
  const updated = arrived.data.state.calls.find((item) => item.id === callRow.id);
  assert.equal(updated.status, "arrived");
  assert.ok(updated.receivedAt);

  const closed = await call(avi, "POST", `/calls/${callRow.id}/status`, { status: "closed", note: "הכל תקין" });
  assert.equal(closed.data.state.calls.find((item) => item.id === callRow.id).status, "closed");
});

test("dismissing a suggestion does not recreate the same polygon", async () => {
  const cookie = await login("dispatch@mishmar.local", "Dispatch1234");
  const state = await call(cookie, "GET", "/state");
  const suggestion = state.data.polygons.find((polygon) => !polygon.confirmed);
  assert.ok(suggestion);
  const removed = await call(cookie, "DELETE", `/polygons/${suggestion.id}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.data));
  assert.ok(!removed.data.state.polygons.some((polygon) => !polygon.confirmed && polygon.callIds.length === suggestion.callIds.length));
});

test("admin imports a workbook and exports a report", async () => {
  const cookie = await login("admin@mishmar.local", "Admin1234");
  const sheet = XLSX.utils.aoa_to_sheet([
    ["שם", "טלפון", "כתובת", "קו רוחב", "קו אורך", "אזור", "הערות"],
    ["בית חדש", "050-9", "הניסיון 1", 32.09, 34.78, "אזור ניסיון", ""],
    ["בלי שם", "", "", "לא מספר", "34.7", "אזור ניסיון", ""],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "בתים");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const form = new FormData();
  form.set("file", new File([buffer], "houses.xlsx"));
  const req = new Request("http://localhost/api/houses/import", { method: "POST", body: form });
  const res = await handleApi(req, ["houses", "import"], cookie);
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.equal(data.created, 1);
  assert.equal(data.skipped, 1);
  assert.ok(data.state.houses.some((house) => house.name === "בית חדש"));

  const report = await call(cookie, "GET", "/reports");
  assert.ok(report.data.total >= 1);
  assert.ok(report.data.rows.some((row) => row.house === "בית כנסת הדר"));
  const csvReq = new Request("http://localhost/api/reports/export");
  const csvRes = await handleApi(csvReq, ["reports", "export"], cookie);
  const bytes = new Uint8Array(await csvRes.arrayBuffer());
  const csv = new TextDecoder().decode(bytes);
  assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xef, 0xbb, 0xbf]);
  assert.ok(csv.includes("בית כנסת הדר"));

  const patrol = await login("avi@mishmar.local");
  const denied = await call(patrol, "GET", "/reports");
  assert.equal(denied.status, 403);
  const anon = await call(jar(), "GET", "/state");
  assert.equal(anon.status, 401);
});
