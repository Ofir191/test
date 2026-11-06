"use client";

import { useMemo, useState } from "react";
import { WEEKDAYS } from "@/lib/format";
import type { DirectoryUser, Role } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/types";
import { useOps } from "./OpsProvider";

type Tab = "users" | "areas" | "houses" | "shifts" | "settings";

const ROLES: Role[] = ["admin", "dispatcher", "patrol", "authorized_user"];

export function AdminApp() {
  const { state } = useOps();
  const [tab, setTab] = useState<Tab>("users");
  if (!state) return null;

  return (
    <div className="admin">
      <aside>
        {(
          [
            ["users", "משתמשים"],
            ["areas", "אזורים"],
            ["houses", "בתים"],
            ["shifts", "משמרות"],
            ["settings", "הגדרות"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </aside>
      <section>
        {tab === "users" && <UsersTab />}
        {tab === "areas" && <AreasTab />}
        {tab === "houses" && <HousesTab />}
        {tab === "shifts" && <ShiftsTab />}
        {tab === "settings" && <SettingsTab />}
      </section>
    </div>
  );
}

function UsersTab() {
  const { state, action } = useOps();
  const blank = { id: 0, fullName: "", email: "", phone: "", password: "", role: "patrol" as Role, active: true, areaIds: [] as number[], shiftId: "" };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  if (!state) return null;

  function edit(user: DirectoryUser) {
    setForm({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone ?? "",
      password: "",
      role: user.role,
      active: user.active,
      areaIds: user.areaIds,
      shiftId: user.shiftId ? String(user.shiftId) : "",
    });
  }

  async function save() {
    setBusy(true);
    const body = {
      fullName: form.fullName,
      email: form.email,
      phone: form.phone,
      password: form.password,
      role: form.role,
      active: form.active,
      areaIds: form.areaIds,
      shiftId: form.shiftId ? Number(form.shiftId) : null,
    };
    const result = await action(form.id ? `/users/${form.id}` : "/users", { method: form.id ? "PATCH" : "POST", body });
    setBusy(false);
    if (result) setForm(blank);
  }

  return (
    <div className="split-admin">
      <div>
        <h2>משתמשים</h2>
        <table>
          <thead><tr><th>שם</th><th>תפקיד</th><th>מצב</th></tr></thead>
          <tbody>
            {state.users.map((user) => (
              <tr key={user.id} onClick={() => edit(user)}>
                <td>{user.fullName}<small>{user.email}</small></td>
                <td>{ROLE_LABEL[user.role]}</td>
                <td>{user.active ? "פעיל" : "כבוי"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="editor" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <h3>{form.id ? "עריכת משתמש" : "משתמש חדש"}</h3>
        <label className="field">שם<input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label>
        <label className="field">אימייל<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
        <label className="field">טלפון<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <label className="field">סיסמה<input type="text" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={form.id ? "השאירו ריק כדי לא לשנות" : "לפחות 6 תווים"} /></label>
        <label className="field">תפקיד
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
            {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
          </select>
        </label>
        {form.role === "patrol" && (
          <>
            <label className="field">משמרת
              <select value={form.shiftId} onChange={(event) => setForm({ ...form, shiftId: event.target.value })}>
                <option value="">בלי הגבלת משמרת</option>
                {state.shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} · {shift.startTime}-{shift.endTime}</option>)}
              </select>
            </label>
            <fieldset className="checks">
              <legend>אזורים</legend>
              {state.areas.map((area) => (
                <label key={area.id}>
                  <input
                    type="checkbox"
                    checked={form.areaIds.includes(area.id)}
                    onChange={(event) => {
                      const areaIds = event.target.checked ? [...form.areaIds, area.id] : form.areaIds.filter((id) => id !== area.id);
                      setForm({ ...form, areaIds });
                    }}
                  />
                  {area.name}
                </label>
              ))}
            </fieldset>
          </>
        )}
        <label className="check"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />חשבון פעיל</label>
        <div className="row-actions">
          <button className="btn btn-gold" disabled={busy} type="submit">{busy ? "שומר…" : "שמירה"}</button>
          {form.id > 0 && <button className="btn btn-ghost" type="button" onClick={() => setForm(blank)}>ניקוי</button>}
        </div>
      </form>
    </div>
  );
}

function AreasTab() {
  const { state, action } = useOps();
  const blank = { id: 0, name: "", description: "", color: "#3dcaa0", centerLat: "", centerLng: "", radiusMeters: "1800" };
  const [form, setForm] = useState(blank);
  if (!state) return null;
  async function save() {
    const body = {
      name: form.name,
      description: form.description,
      color: form.color,
      centerLat: form.centerLat === "" ? null : Number(form.centerLat),
      centerLng: form.centerLng === "" ? null : Number(form.centerLng),
      radiusMeters: Number(form.radiusMeters),
    };
    const result = await action(form.id ? `/areas/${form.id}` : "/areas", { method: form.id ? "PATCH" : "POST", body });
    if (result) setForm(blank);
  }
  return (
    <div className="split-admin">
      <div>
        <h2>אזורים</h2>
        <table>
          <tbody>
            {state.areas.map((area) => (
              <tr key={area.id} onClick={() => setForm({ id: area.id, name: area.name, description: area.description ?? "", color: area.color, centerLat: area.centerLat?.toString() ?? "", centerLng: area.centerLng?.toString() ?? "", radiusMeters: String(area.radiusMeters) })}>
                <td><i className="swatch" style={{ background: area.color }} />{area.name}<small>{area.description}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="editor" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <h3>{form.id ? "עריכת אזור" : "אזור חדש"}</h3>
        <label className="field">שם<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
        <label className="field">תיאור<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label className="field">צבע<input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} /></label>
        <label className="field">קו רוחב<input value={form.centerLat} onChange={(event) => setForm({ ...form, centerLat: event.target.value })} /></label>
        <label className="field">קו אורך<input value={form.centerLng} onChange={(event) => setForm({ ...form, centerLng: event.target.value })} /></label>
        <label className="field">רדיוס במטרים<input value={form.radiusMeters} onChange={(event) => setForm({ ...form, radiusMeters: event.target.value })} /></label>
        <div className="row-actions">
          <button className="btn btn-gold" type="submit">שמירה</button>
          {form.id > 0 && (
            <button className="btn btn-ghost" type="button" onClick={() => action(`/areas/${form.id}`, { method: "DELETE" }).then((result) => result && setForm(blank))}>
              מחיקה
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function HousesTab() {
  const { state, action } = useOps();
  const [q, setQ] = useState("");
  const blank = { id: 0, name: "", phone: "", address: "", lat: "", lng: "", areaId: "", notes: "", ownerUserId: "" };
  const [form, setForm] = useState(blank);
  const [importNote, setImportNote] = useState("");
  if (!state) return null;
  const owners = state.users.filter((user) => user.role === "authorized_user");
  const houses = state.houses.filter((house) => !q || [house.name, house.address, house.phone].some((value) => value?.includes(q)));

  async function save() {
    const body = {
      name: form.name,
      phone: form.phone,
      address: form.address,
      lat: form.lat === "" ? null : Number(form.lat),
      lng: form.lng === "" ? null : Number(form.lng),
      areaId: form.areaId ? Number(form.areaId) : null,
      notes: form.notes,
      ownerUserId: form.ownerUserId ? Number(form.ownerUserId) : null,
    };
    const result = await action(form.id ? `/houses/${form.id}` : "/houses", { method: form.id ? "PATCH" : "POST", body });
    if (result) setForm(blank);
  }

  async function upload(file: File) {
    const formData = new FormData();
    formData.set("file", file);
    const result = await action("/houses/import", { form: formData });
    if (!result) return;
    const errors = Array.isArray(result.errors) ? result.errors as { line: number; message: string }[] : [];
    setImportNote(`נוספו ${result.created ?? 0} בתים, דולגו ${result.skipped ?? 0}.${errors.length ? ` ${errors.slice(0, 3).map((error) => `שורה ${error.line}: ${error.message}`).join(" · ")}` : ""}`);
  }

  return (
    <div className="split-admin">
      <div>
        <h2>בתים</h2>
        <div className="row-actions">
          <input className="search" placeholder="חיפוש" value={q} onChange={(event) => setQ(event.target.value)} />
          <a className="btn btn-ghost" href="/api/houses/template">תבנית אקסל</a>
          <label className="btn btn-ghost">
            ייבוא
            <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} />
          </label>
        </div>
        {importNote && <p className="picked">{importNote}</p>}
        <table>
          <tbody>
            {houses.map((house) => (
              <tr key={house.id} onClick={() => setForm({
                id: house.id,
                name: house.name,
                phone: house.phone ?? "",
                address: house.address ?? "",
                lat: house.lat?.toString() ?? "",
                lng: house.lng?.toString() ?? "",
                areaId: house.areaId ? String(house.areaId) : "",
                notes: house.notes ?? "",
                ownerUserId: house.ownerUserId ? String(house.ownerUserId) : "",
              })}>
                <td>{house.name}<small>{house.address}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="editor" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <h3>{form.id ? "עריכת בית" : "בית חדש"}</h3>
        <label className="field">שם<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
        <label className="field">טלפון<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <label className="field">כתובת<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
        <label className="field">קו רוחב<input value={form.lat} onChange={(event) => setForm({ ...form, lat: event.target.value })} /></label>
        <label className="field">קו אורך<input value={form.lng} onChange={(event) => setForm({ ...form, lng: event.target.value })} /></label>
        <label className="field">אזור
          <select value={form.areaId} onChange={(event) => setForm({ ...form, areaId: event.target.value })}>
            <option value="">ללא</option>
            {state.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
        </label>
        <label className="field">בעלים
          <select value={form.ownerUserId} onChange={(event) => setForm({ ...form, ownerUserId: event.target.value })}>
            <option value="">ללא</option>
            {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.fullName}</option>)}
          </select>
        </label>
        <label className="field">הערות לסייר<textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        <div className="row-actions">
          <button className="btn btn-gold" type="submit">שמירה</button>
          {form.id > 0 && <button className="btn btn-ghost" type="button" onClick={() => action(`/houses/${form.id}`, { method: "DELETE" }).then((result) => result && setForm(blank))}>הסרה</button>}
        </div>
      </form>
    </div>
  );
}

function ShiftsTab() {
  const { state, action } = useOps();
  const blank = { id: 0, name: "", startTime: "06:00", endTime: "15:00", days: [0, 1, 2, 3, 4, 5, 6], active: true };
  const [form, setForm] = useState(blank);
  if (!state) return null;
  async function save() {
    const result = await action(form.id ? `/shifts/${form.id}` : "/shifts", {
      method: form.id ? "PATCH" : "POST",
      body: { name: form.name, startTime: form.startTime, endTime: form.endTime, days: form.days, active: form.active },
    });
    if (result) setForm(blank);
  }
  return (
    <div className="split-admin">
      <div>
        <h2>משמרות</h2>
        <p className="muted">סייר פעיל נבחר רק אם הוא סימן פעיל, המשמרת שלו בתוקף, והוא באזור או בטווח המיקום.</p>
        <table>
          <tbody>
            {state.shifts.map((shift) => (
              <tr key={shift.id} onClick={() => setForm({ id: shift.id, name: shift.name, startTime: shift.startTime, endTime: shift.endTime, days: shift.days, active: shift.active })}>
                <td>{shift.name}<small><bdi dir="ltr">{shift.startTime}–{shift.endTime}</bdi> · {shift.days.map((day) => WEEKDAYS[day]).join(" ")}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="editor" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <h3>{form.id ? "עריכת משמרת" : "משמרת חדשה"}</h3>
        <label className="field">שם<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
        <label className="field">התחלה<input value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} /></label>
        <label className="field">סיום<input value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} /></label>
        <fieldset className="checks">
          <legend>ימים</legend>
          {WEEKDAYS.map((label, day) => (
            <label key={label}>
              <input
                type="checkbox"
                checked={form.days.includes(day)}
                onChange={(event) => {
                  const days = event.target.checked ? [...form.days, day] : form.days.filter((value) => value !== day);
                  setForm({ ...form, days });
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="check"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />פעילה</label>
        <div className="row-actions">
          <button className="btn btn-gold" type="submit">שמירה</button>
          {form.id > 0 && <button className="btn btn-ghost" type="button" onClick={() => action(`/shifts/${form.id}`, { method: "DELETE" }).then((result) => result && setForm(blank))}>מחיקה</button>}
        </div>
      </form>
    </div>
  );
}

function SettingsTab() {
  const { state, action } = useOps();
  const initial = useMemo(() => state?.settings, [state]);
  const [polygon, setPolygon] = useState(String(initial?.polygonRadiusMeters ?? 500));
  const [gps, setGps] = useState(String(initial?.gpsMatchMeters ?? 3000));
  if (!state) return null;
  return (
    <form
      className="editor narrow"
      onSubmit={(event) => {
        event.preventDefault();
        action("/settings", { method: "PATCH", body: { polygonRadiusMeters: Number(polygon), gpsMatchMeters: Number(gps) } });
      }}
    >
      <h2>הגדרות שטח</h2>
      <label className="field">
        מרחק לקיבוץ קריאות לפוליגון (מטרים)
        <input value={polygon} onChange={(event) => setPolygon(event.target.value)} />
      </label>
      <p className="muted">ברירת המחדל 500. קריאות פתוחות בטווח הזה מוצעות כמוקד אחד למוקד ולסייר.</p>
      <label className="field">
        טווח GPS לשיבוץ סייר (מטרים)
        <input value={gps} onChange={(event) => setGps(event.target.value)} />
      </label>
      <p className="muted">סייר פעיל נחשב זמין אם הוא משויך לאזור הבית, או שנמצא בטווח הזה מהבית.</p>
      <button className="btn btn-gold" type="submit">שמירה וחישוב מחדש</button>
    </form>
  );
}
