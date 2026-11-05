import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const g = globalThis;

export function dbFile() {
  return process.env.MISHMAR_DB || path.join(process.cwd(), "data", "mishmar.db");
}

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

export function resetDbForTests() {
  if (g.__mishmarDb) {
    try {
      g.__mishmarDb.close();
    } catch {
      /* already closed */
    }
    g.__mishmarDb = null;
  }
}

let opening = null;

export function getDb() {
  if (g.__mishmarDb) return Promise.resolve(g.__mishmarDb);
  if (!opening) {
    opening = (async () => {
      const db = openDatabase(dbFile());
      const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
      if (count === 0 && process.env.MISHMAR_SKIP_SEED !== "1") {
        const { seedDemo } = await import("./seed.mjs");
        seedDemo(db);
      }
      g.__mishmarDb = db;
      opening = null;
      return db;
    })().catch((error) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}


export function q(db) {
  return {
    all(sql, ...params) {
      return db.prepare(sql).all(...params).map((row) => ({ ...row }));
    },
    get(sql, ...params) {
      const row = db.prepare(sql).get(...params);
      return row ? { ...row } : null;
    },
    run(sql, ...params) {
      const info = db.prepare(sql).run(...params);
      return { id: Number(info.lastInsertRowid), changes: Number(info.changes) };
    },
  };
}

let txDepth = 0;

export function tx(db, fn) {
  if (txDepth === 0) db.exec("BEGIN");
  txDepth += 1;
  try {
    const value = fn();
    txDepth -= 1;
    if (txDepth === 0) db.exec("COMMIT");
    return value;
  } catch (error) {
    txDepth = 0;
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore rollback failure */
    }
    throw error;
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL CHECK(role IN ('admin','dispatcher','patrol','authorized_user')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS areas (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      color TEXT NOT NULL,
      center_lat REAL,
      center_lng REAL,
      radius_meters INTEGER NOT NULL DEFAULT 2500,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS houses (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      lat REAL,
      lng REAL,
      area_id INTEGER REFERENCES areas(id),
      notes TEXT,
      owner_user_id INTEGER REFERENCES users(id),
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      area_id INTEGER REFERENCES areas(id),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      days TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS patrol_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      is_active INTEGER NOT NULL DEFAULT 0,
      lat REAL,
      lng REAL,
      location_updated_at TEXT,
      shift_id INTEGER REFERENCES shifts(id)
    );

    CREATE TABLE IF NOT EXISTS patrol_areas (
      user_id INTEGER NOT NULL REFERENCES users(id),
      area_id INTEGER NOT NULL REFERENCES areas(id),
      PRIMARY KEY (user_id, area_id)
    );

    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY,
      house_id INTEGER NOT NULL REFERENCES houses(id),
      status TEXT NOT NULL,
      opened_by INTEGER NOT NULL REFERENCES users(id),
      assigned_patrol_id INTEGER REFERENCES users(id),
      notes TEXT,
      opened_at TEXT NOT NULL,
      received_at TEXT,
      en_route_at TEXT,
      arrived_at TEXT,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS call_events (
      id INTEGER PRIMARY KEY,
      call_id INTEGER NOT NULL REFERENCES calls(id),
      status TEXT NOT NULL,
      actor_id INTEGER REFERENCES users(id),
      note TEXT,
      lat REAL,
      lng REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS polygons (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      confirmed INTEGER NOT NULL DEFAULT 0,
      radius_meters INTEGER NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS polygon_calls (
      polygon_id INTEGER NOT NULL REFERENCES polygons(id) ON DELETE CASCADE,
      call_id INTEGER NOT NULL REFERENCES calls(id),
      PRIMARY KEY (polygon_id, call_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      call_id INTEGER REFERENCES calls(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suggestion_dismissals (
      id INTEGER PRIMARY KEY,
      signature TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
    CREATE INDEX IF NOT EXISTS idx_calls_house ON calls(house_id);
    CREATE INDEX IF NOT EXISTS idx_houses_area ON houses(area_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
    CREATE INDEX IF NOT EXISTS idx_events_call ON call_events(call_id);
  `);
}
