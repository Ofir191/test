"use client";

import { useEffect, useMemo, useState } from "react";
import { coveringShape, haversine } from "@/lib/geo.mjs";
import { formatDistance, formatWhen, mapsLink, statusClass, wazeLink } from "@/lib/format";
import type { Call, CallStatus, House } from "@/lib/types";
import { NEXT_STATUS, STATUS_LABEL } from "@/lib/types";
import { MapCanvas, type MapMarker, type MapShape } from "./MapCanvas";
import { useOps } from "./OpsProvider";

const FLOW: { key: CallStatus; label: string; stamp: keyof Call }[] = [
  { key: "new", label: "נשלחה", stamp: "openedAt" },
  { key: "received", label: "התקבלה", stamp: "receivedAt" },
  { key: "en_route", label: "בדרך", stamp: "enRouteAt" },
  { key: "arrived", label: "הגיע", stamp: "arrivedAt" },
  { key: "closed", label: "נסגרה", stamp: "closedAt" },
];

export function DispatchBoard() {
  const { state, action } = useOps();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"open" | "history">("open");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [houseId, setHouseId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [composer, setComposer] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState<number[]>([]);
  const [pane, setPane] = useState<"list" | "map">("list");
  const [showHouses, setShowHouses] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<number>).detail;
      setSelectedId(id);
      setTab("open");
      setPane("list");
    };
    window.addEventListener("mishmar-open-call", open);
    return () => window.removeEventListener("mishmar-open-call", open);
  }, []);

  const areaName = useMemo(() => {
    const map = new Map(state?.areas.map((area) => [area.id, area]) ?? []);
    return (id: number | null | undefined) => (id ? map.get(id) : undefined);
  }, [state]);

  if (!state) return null;

  const openCalls = state.calls.filter((call) => call.status !== "closed");
  const history = state.calls.filter((call) => call.status === "closed");
  const needle = query.trim();
  const matches = (call: Call) => {
    if (!needle) return true;
    const house = call.house;
    return [house?.name, house?.address, house?.phone, call.assigneeName, call.notes, String(call.id)]
      .filter(Boolean)
      .some((value) => String(value).includes(needle));
  };
  const visible = (tab === "open" ? openCalls : history).filter(matches);
  const selected = state.calls.find((call) => call.id === selectedId) ?? null;
  const suggestions = state.polygons.filter(
    (polygon) => !polygon.confirmed && polygon.callIds.some((id) => openCalls.some((call) => call.id === id)),
  );

  const markers: MapMarker[] = [];
  const openHouseIds = new Set(openCalls.map((call) => call.houseId));
  if (showHouses) {
    for (const house of state.houses) {
      if (house.lat == null || house.lng == null || openHouseIds.has(house.id)) continue;
      markers.push({
        id: `house-${house.id}`,
        lat: house.lat,
        lng: house.lng,
        kind: "house",
        color: areaName(house.areaId)?.color ?? "#8ea3b5",
        label: house.name,
      });
    }
  }
  for (const call of openCalls) {
    if (call.house?.lat == null || call.house.lng == null) continue;
    markers.push({
      id: `call-${call.id}`,
      lat: call.house.lat,
      lng: call.house.lng,
      kind: "call",
      status: call.status,
      color: "var(--pin)",
      label: `${call.house.name} · ${call.statusLabel}`,
    });
  }
  for (const patrol of state.patrols) {
    if (!patrol.isActive || patrol.lat == null || patrol.lng == null) continue;
    markers.push({
      id: `patrol-${patrol.id}`,
      lat: patrol.lat,
      lng: patrol.lng,
      kind: "patrol",
      color: patrol.onShift ? "#e8a838" : "#8ea3b5",
      label: `${patrol.fullName}${patrol.isActive ? " · פעיל" : ""}`,
    });
  }

  const shapes: MapShape[] = state.polygons.flatMap((polygon) => {
    const coords = polygon.callIds
      .map((id) => state.calls.find((call) => call.id === id))
      .filter((call) => call && call.status !== "closed" && call.house?.lat != null && call.house.lng != null)
      .map((call) => ({ lat: call!.house!.lat as number, lng: call!.house!.lng as number }));
    const shape = coveringShape(coords);
    return shape ? [{ id: polygon.id, confirmed: polygon.confirmed, ...shape }] : [];
  });

  function chooseHouse(house: House) {
    const existing = openCalls.find((call) => call.houseId === house.id);
    if (existing) {
      setSelectedId(existing.id);
      setComposer(false);
      setPane("list");
      return;
    }
    setHouseId(house.id);
    setComposer(true);
    setNotes("");
  }

  async function submitCall() {
    if (!houseId) return;
    setBusy(true);
    const result = await action("/calls", { body: { houseId, notes } });
    setBusy(false);
    if (!result) return;
    setComposer(false);
    setNotes("");
    if (typeof result.callId === "number") setSelectedId(result.callId);
  }

  async function linkSelected() {
    if (linked.length < 2) return;
    setBusy(true);
    const result = await action("/polygons", { body: { name: "פוליגון ידני", callIds: linked } });
    setBusy(false);
    if (!result) return;
    setLinking(false);
    setLinked([]);
  }

  const pickedHouse = state.houses.find((house) => house.id === houseId) ?? null;
  const houseChoices = state.houses.filter((house) => {
    if (!needle) return true;
    return [house.name, house.address, house.phone].filter(Boolean).some((value) => String(value).includes(needle));
  });

  return (
    <div className={`dispatch ${selected ? "has-drawer" : ""}`} data-pane={pane}>
      <aside className="sidebar">
        <div className="side-head">
          <div className="seg">
            <button type="button" className={tab === "open" ? "is-on" : ""} onClick={() => setTab("open")}>
              פתוחות <b>{openCalls.length}</b>
            </button>
            <button type="button" className={tab === "history" ? "is-on" : ""} onClick={() => setTab("history")}>
              היסטוריה
            </button>
          </div>
          <div className="pane-toggle">
            <button type="button" className={pane === "list" ? "is-on" : ""} onClick={() => setPane("list")}>רשימה</button>
            <button type="button" className={pane === "map" ? "is-on" : ""} onClick={() => setPane("map")}>מפה</button>
          </div>
          <input
            className="search"
            placeholder="חיפוש בית, כתובת, טלפון או מספר קריאה"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="side-actions">
            <button type="button" className="btn btn-gold" data-testid="new-call" onClick={() => { setComposer(true); setHouseId(null); }}>
              קריאה חדשה
            </button>
            <button
              type="button"
              className={linking ? "btn btn-gold" : "btn btn-ghost"}
              onClick={() => {
                setLinking((value) => !value);
                setLinked([]);
              }}
            >
              {linking ? "ביטול קישור" : "קישור קריאות"}
            </button>
            <label className="check">
              <input type="checkbox" checked={showHouses} onChange={(event) => setShowHouses(event.target.checked)} />
              בתים
            </label>
          </div>
          {linking && (
            <button type="button" className="btn btn-gold wide" disabled={linked.length < 2 || busy} onClick={linkSelected}>
              יצירת פוליגון מ-{linked.length} קריאות
            </button>
          )}
        </div>
        <div className="patrol-strip">
          {state.patrols.map((patrol) => (
            <span key={patrol.id} className={patrol.isActive && patrol.onShift ? "chip is-on" : "chip"}>
              {patrol.fullName}
              <small>{!patrol.accountActive ? "חסום" : !patrol.isActive ? "לא פעיל" : !patrol.onShift ? "מחוץ למשמרת" : "פעיל"}</small>
            </span>
          ))}
        </div>
        {suggestions.map((polygon) => (
          <div key={polygon.id} className="suggest">
            <div>
              <strong>{polygon.name}</strong>
              <p>קריאות בטווח {polygon.radiusMeters} מ׳. אפשר לאשר או להתעלם.</p>
            </div>
            <div className="row-actions">
              <button
                type="button"
                className="btn btn-gold"
                onClick={() => action(`/polygons/${polygon.id}`, { method: "PATCH", body: { name: polygon.name.replace("הצעה · ", ""), confirmed: true, callIds: polygon.callIds } })}
              >
                אישור
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => action(`/polygons/${polygon.id}`, { method: "DELETE" })}>
                התעלמות
              </button>
            </div>
          </div>
        ))}
        <div className="call-scroll">
          {visible.length === 0 && <p className="empty">אין קריאות להצגה</p>}
          {visible.map((call) => {
            const polygon = state.polygons.find((item) => item.callIds.includes(call.id));
            return (
              <button
                key={call.id}
                type="button"
                data-testid="call-row"
                className={`call-row ${selectedId === call.id ? "is-on" : ""} ${call.assignedPatrolId ? "" : "is-loose"}`}
                onClick={() => {
                  if (linking && call.status !== "closed") {
                    setLinked((current) => current.includes(call.id) ? current.filter((id) => id !== call.id) : [...current, call.id]);
                    return;
                  }
                  setSelectedId(call.id);
                  setPane("list");
                }}
              >
                <i className={statusClass(call.status)} />
                <span>
                  <strong>{call.house?.name ?? "בית"}</strong>
                  <small>
                    {call.house?.address} · {areaName(call.house?.areaId)?.name ?? "ללא אזור"}
                    {polygon ? ` · ${polygon.confirmed ? "פוליגון" : "הצעה"}` : ""}
                  </small>
                </span>
                <em className={statusClass(call.status)}>{linking && linked.includes(call.id) ? "נבחר" : call.statusLabel}</em>
                <time>{formatWhen(call.openedAt)}</time>
              </button>
            );
          })}
        </div>
      </aside>

      {selected && (
        <section className="drawer">
          <header>
            <div>
              <p className="kicker">קריאה {selected.id}</p>
              <h2>{selected.house?.name}</h2>
              <p>{selected.house?.address}</p>
            </div>
            <button type="button" className="icon-btn" onClick={() => setSelectedId(null)}>סגירה</button>
          </header>
          <ol className="stepper">
            {FLOW.map((step) => {
              const at = selected[step.stamp] as string | null;
              return (
                <li key={step.key} className={at ? "is-done" : ""}>
                  <b>{step.label}</b>
                  <small>{at ? formatWhen(at) : "ממתין"}</small>
                </li>
              );
            })}
          </ol>
          <dl className="facts">
            <div><dt>אזור</dt><dd>{areaName(selected.house?.areaId)?.name ?? "—"}</dd></div>
            <div><dt>טלפון</dt><dd>{selected.house?.phone ? <a href={`tel:${selected.house.phone}`}>{selected.house.phone}</a> : "—"}</dd></div>
            <div><dt>נפתחה על ידי</dt><dd>{selected.openerName}</dd></div>
            <div><dt>סייר</dt><dd>{selected.assigneeName ?? "לא שובץ"}</dd></div>
          </dl>
          {(selected.notes || selected.house?.notes) && (
            <div className="note-box">
              {selected.notes && <p><b>הערת פתיחה. </b>{selected.notes}</p>}
              {selected.house?.notes && <p><b>הערות בית. </b>{selected.house.notes}</p>}
            </div>
          )}
          {selected.house?.lat != null && selected.house.lng != null && (
            <div className="row-actions">
              <a className="btn btn-ghost" href={mapsLink(selected.house.lat, selected.house.lng)} target="_blank" rel="noreferrer">ניווט במפות</a>
              <a className="btn btn-ghost" href={wazeLink(selected.house.lat, selected.house.lng)} target="_blank" rel="noreferrer">Waze</a>
            </div>
          )}
          {selected.status !== "closed" && (
            <label className="field">
              שיוך לסייר
              <select
                value={selected.assignedPatrolId ?? ""}
                onChange={(event) => {
                  if (event.target.value) action(`/calls/${selected.id}/assign`, { body: { patrolId: Number(event.target.value) } });
                }}
              >
                <option value="">בחירת סייר</option>
                {state.patrols.map((patrol) => {
                  const houseLat = selected.house?.lat;
                  const houseLng = selected.house?.lng;
                  const distance =
                    patrol.lat != null && patrol.lng != null && houseLat != null && houseLng != null
                      ? formatDistance(haversine(patrol.lat, patrol.lng, houseLat, houseLng))
                      : null;
                  const flag = !patrol.isActive ? "לא פעיל" : !patrol.onShift ? "מחוץ למשמרת" : "פעיל";
                  return (
                    <option key={patrol.id} value={patrol.id}>
                      {patrol.fullName} · {flag}{distance ? ` · ${distance}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
          {selected.status !== "closed" && (
            <div className="row-actions">
              {(["received", "en_route", "arrived", "closed"] as CallStatus[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  className="btn btn-ghost"
                  disabled={!NEXT_STATUS[selected.status].includes(status)}
                  onClick={() => action(`/calls/${selected.id}/status`, { body: { status } })}
                >
                  {STATUS_LABEL[status]}
                </button>
              ))}
            </div>
          )}
          <h3>יומן</h3>
          <ul className="log">
            {selected.events.map((event) => (
              <li key={event.id}>
                <b>{STATUS_LABEL[event.status as CallStatus] ?? event.status}</b>
                <span>{event.actorName}{event.note ? ` · ${event.note}` : ""}</span>
                <time>{formatWhen(event.createdAt)}</time>
              </li>
            ))}
          </ul>
          {state.polygons.filter((polygon) => polygon.callIds.includes(selected.id)).map((polygon) => (
            <div key={polygon.id} className="note-box">
              <p><b>{polygon.confirmed ? "פוליגון" : "הצעת פוליגון"}. </b>{polygon.name}</p>
              <div className="row-actions">
                {!polygon.confirmed && (
                  <button type="button" className="btn btn-gold" onClick={() => action(`/polygons/${polygon.id}`, { method: "PATCH", body: { name: polygon.name.replace("הצעה · ", ""), confirmed: true, callIds: polygon.callIds } })}>
                    אישור
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => action(`/polygons/${polygon.id}`, { method: "DELETE" })}>
                  פירוק
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="map-pane">
        <MapCanvas
          markers={markers}
          shapes={shapes}
          selectedId={selected ? `call-${selected.id}` : null}
          layoutKey={`${pane}-${selected ? "d" : "x"}`}
          onSelect={(id) => {
            if (id.startsWith("call-")) {
              setSelectedId(Number(id.slice(5)));
              setPane("list");
            } else if (id.startsWith("house-")) {
              const house = state.houses.find((item) => item.id === Number(id.slice(6)));
              if (house) chooseHouse(house);
            }
          }}
          onShape={(id) => {
            const polygon = state.polygons.find((item) => item.id === id);
            const callId = polygon?.callIds.find((item) => openCalls.some((call) => call.id === item));
            if (callId) setSelectedId(callId);
          }}
        />
      </div>

      {composer && (
        <div className="modal-back" onClick={() => setComposer(false)}>
          <form
            className="modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              submitCall();
            }}
          >
            <header>
              <h2>פתיחת קריאה</h2>
              <button type="button" className="icon-btn" onClick={() => setComposer(false)}>סגירה</button>
            </header>
            <input className="search" placeholder="חיפוש בית" value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="house-picks">
              {houseChoices.slice(0, 8).map((house) => (
                <button
                  type="button"
                  key={house.id}
                  className={houseId === house.id ? "is-on" : ""}
                  onClick={() => setHouseId(house.id)}
                >
                  <strong>{house.name}</strong>
                  <small>{house.address} · {areaName(house.areaId)?.name ?? "ללא אזור"}</small>
                </button>
              ))}
            </div>
            {pickedHouse && <p className="picked">נבחר: {pickedHouse.name}{pickedHouse.address ? `, ${pickedHouse.address}` : ""}</p>}
            <label className="field">
              הערה לסייר
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="מה קורה במקום" />
            </label>
            <button className="btn btn-gold" type="submit" disabled={!houseId || busy} data-testid="send-call">
              {busy ? "שולח…" : "שליחה לסייר הפעיל"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
