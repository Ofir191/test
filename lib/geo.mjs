const EARTH = 6371000;

export function haversine(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDeg(from, to) {
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function destination(lat, lng, bearing, distanceM) {
  const δ = distanceM / EARTH;
  const θ = (bearing * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return { lat: (φ2 * 180) / Math.PI, lng: (((λ2 * 180) / Math.PI + 540) % 360) - 180 };
}

export function clusterByDistance(points, radiusMeters) {
  const parent = points.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };
  for (let i = 0; i < points.length; i++) {
    if (points[i].lat == null || points[i].lng == null) continue;
    for (let j = i + 1; j < points.length; j++) {
      if (points[j].lat == null || points[j].lng == null) continue;
      const d = haversine(points[i].lat, points[i].lng, points[j].lat, points[j].lng);
      if (d <= radiusMeters) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < points.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(points[i]);
  }
  return [...groups.values()];
}

function cross(o, a, b) {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

export function convexHull(points) {
  const pts = [...points].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  if (pts.length <= 2) return pts;
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function coveringShape(coords) {
  const pts = coords.filter((c) => c && c.lat != null && c.lng != null);
  if (!pts.length) return null;
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  const center = { lat, lng };
  if (pts.length < 3) {
    let radius = 80;
    for (const p of pts) radius = Math.max(radius, haversine(lat, lng, p.lat, p.lng) + 55);
    return { type: "circle", lat, lng, radius };
  }
  const hull = convexHull(pts);
  const expanded = hull.map((p) => {
    const brg = bearingDeg(center, p);
    return destination(p.lat, p.lng, brg, 45);
  });
  return { type: "polygon", points: expanded };
}
