import assert from "node:assert/strict";
import test from "node:test";
import { clusterByDistance, coveringShape, haversine } from "../lib/geo.mjs";
import { jerusalemDayStart, shiftCovers } from "../lib/time.mjs";

test("distance between nearby houses is under the default polygon radius", () => {
  const meters = haversine(32.0962, 34.7861, 32.0968, 34.7874);
  assert.ok(meters > 100 && meters < 200, `expected about 140m, got ${meters}`);
});

test("clusters only points inside the radius", () => {
  const groups = clusterByDistance(
    [
      { id: 1, lat: 32.0962, lng: 34.7861 },
      { id: 2, lat: 32.0968, lng: 34.7874 },
      { id: 3, lat: 32.0655, lng: 34.7755 },
    ],
    500,
  );
  const sizes = groups.map((group) => group.length).sort();
  assert.deepEqual(sizes, [1, 2]);
});

test("a pair of points is covered by a circle", () => {
  const shape = coveringShape([
    { lat: 32.0962, lng: 34.7861 },
    { lat: 32.0968, lng: 34.7874 },
  ]);
  assert.equal(shape.type, "circle");
  assert.ok(shape.radius > 50);
});

test("shifts follow the Asia/Jerusalem clock, including overnight", () => {
  const allWeek = { active: 1, days: [0, 1, 2, 3, 4, 5, 6] };
  const noonUtc = new Date("2026-11-05T12:00:00Z");
  assert.equal(shiftCovers({ ...allWeek, start_time: "06:00", end_time: "15:00" }, noonUtc), true);
  assert.equal(shiftCovers({ ...allWeek, start_time: "15:00", end_time: "23:00" }, noonUtc), false);
  const afterMidnight = new Date("2026-11-05T22:30:00Z");
  assert.equal(shiftCovers({ ...allWeek, start_time: "23:00", end_time: "06:00" }, afterMidnight), true);
  assert.equal(shiftCovers({ ...allWeek, start_time: "06:00", end_time: "15:00" }, afterMidnight), false);
});

test("a Jerusalem calendar day starts before UTC midnight in winter", () => {
  const start = jerusalemDayStart("2026-11-05");
  assert.equal(start, "2026-11-04T22:00:00.000Z");
});
