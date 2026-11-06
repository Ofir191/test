"use client";

import { useState } from "react";
import { formatWhen, statusClass } from "@/lib/format";
import type { CallStatus } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/types";
import { MapCanvas, type MapMarker } from "./MapCanvas";
import { useOps } from "./OpsProvider";

const FLOW: { key: CallStatus; label: string }[] = [
  { key: "new", label: "נשלחה" },
  { key: "received", label: "התקבלה" },
  { key: "en_route", label: "בדרך" },
  { key: "arrived", label: "הגיע" },
  { key: "closed", label: "נסגרה" },
];

export function PortalApp() {
  const { state, action } = useOps();
  const [houseId, setHouseId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  if (!state) return null;
  const areaById = new Map(state.areas.map((area) => [area.id, area]));
  const markers: MapMarker[] = state.houses.flatMap((house) => {
    if (house.lat == null || house.lng == null) return [];
    const open = state.calls.find((call) => call.houseId === house.id && call.status !== "closed");
    return [{
      id: open ? `call-${open.id}` : `house-${house.id}`,
      lat: house.lat,
      lng: house.lng,
      kind: open ? "call" as const : "house" as const,
      status: open?.status,
      color: areaById.get(house.areaId ?? -1)?.color ?? "#e8a838",
      label: house.name,
    }];
  });

  async function submit() {
    if (!houseId) return;
    setBusy(true);
    const result = await action("/calls", { body: { houseId, notes } });
    setBusy(false);
    if (!result) return;
    setNotes("");
  }

  return (
    <div className="portal">
      <section>
        <header className="page-intro">
          <p className="kicker">משתמש מורשה</p>
          <h2>הבתים והקריאות שלי</h2>
        </header>
        {state.houses.length === 0 && <p className="empty">אין בתים משויכים אליך. פנו למנהל המערכת.</p>}
        <div className="house-cards">
          {state.houses.map((house) => {
            const open = state.calls.find((call) => call.houseId === house.id && call.status !== "closed");
            return (
              <button
                key={house.id}
                type="button"
                className={houseId === house.id ? "house-card is-on" : "house-card"}
                onClick={() => setHouseId(house.id)}
                disabled={!!open}
              >
                <strong>{house.name}</strong>
                <span>{house.address}</span>
                <small>{areaById.get(house.areaId ?? -1)?.name ?? "ללא אזור"}</small>
                {open && <em className={statusClass(open.status)}>יש קריאה {open.statusLabel}</em>}
              </button>
            );
          })}
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="field">
            מה קורה
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="תיאור קצר למוקד ולסייר" />
          </label>
          <button className="btn btn-gold" type="submit" data-testid="portal-open" disabled={!houseId || busy}>
            {busy ? "שולח…" : "פתיחת קריאה"}
          </button>
        </form>
        <h3>המעקב שלי</h3>
        <div className="stack">
          {state.calls.length === 0 && <p className="empty">עוד לא נפתחו קריאות</p>}
          {state.calls.map((call) => (
            <article key={call.id} className="job-card">
              <header>
                <strong>{call.house?.name}</strong>
                <em className={statusClass(call.status)}>{STATUS_LABEL[call.status]}</em>
              </header>
              <p>{call.house?.address}</p>
              {call.notes && <p>{call.notes}</p>}
              <ol className="stepper">
                {FLOW.map((step) => {
                  const at = step.key === "new" ? call.openedAt : step.key === "received" ? call.receivedAt : step.key === "en_route" ? call.enRouteAt : step.key === "arrived" ? call.arrivedAt : call.closedAt;
                  return <li key={step.key} className={at ? "is-done" : ""}><b>{step.label}</b><small>{at ? formatWhen(at) : ""}</small></li>;
                })}
              </ol>
              {call.assigneeName && <p className="muted">הסייר המשויך: {call.assigneeName}</p>}
            </article>
          ))}
        </div>
      </section>
      <div className="map-pane">
        <MapCanvas
          markers={markers}
          shapes={[]}
          onSelect={(id) => {
            if (!id.startsWith("house-")) return;
            const idNum = Number(id.slice(6));
            const open = state.calls.some((call) => call.houseId === idNum && call.status !== "closed");
            if (!open) setHouseId(idNum);
          }}
        />
      </div>
    </div>
  );
}
