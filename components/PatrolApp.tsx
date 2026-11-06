"use client";

import { useEffect, useRef, useState } from "react";
import { coveringShape } from "@/lib/geo.mjs";
import { formatWhen, mapsLink, statusClass, wazeLink } from "@/lib/format";
import type { CallStatus } from "@/lib/types";
import { NEXT_STATUS, STATUS_LABEL } from "@/lib/types";
import { MapCanvas, type MapMarker, type MapShape } from "./MapCanvas";
import { useOps } from "./OpsProvider";

export function PatrolApp() {
  const { state, action } = useOps();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [closeNote, setCloseNote] = useState("");
  const [gps, setGps] = useState<"idle" | "on" | "off">("idle");
  const actionRef = useRef(action);
  actionRef.current = action;
  const lastSent = useRef(0);

  useEffect(() => {
    const open = (event: Event) => setSelectedId((event as CustomEvent<number>).detail);
    window.addEventListener("mishmar-open-call", open);
    return () => window.removeEventListener("mishmar-open-call", open);
  }, []);

  useEffect(() => {
    if (!state || state.me.role !== "patrol" || !state.me.isActive) return;
    if (!navigator.geolocation) {
      setGps("off");
      return;
    }
    const send = (pos?: GeolocationPosition) => {
      const now = Date.now();
      if (now - lastSent.current < 15000) return;
      lastSent.current = now;
      actionRef.current("/presence", {
        body: { active: true, lat: pos?.coords.latitude, lng: pos?.coords.longitude },
      });
    };
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        setGps("on");
        send(pos);
      },
      () => setGps("off"),
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [state?.me.isActive, state?.me.role]);

  if (!state) return null;
  const areaById = new Map(state.areas.map((area) => [area.id, area]));
  const mine = state.calls.filter((call) => call.status !== "closed" && call.assignedPatrolId === state.me.id);
  const areaCalls = state.calls.filter(
    (call) => call.status !== "closed" && call.assignedPatrolId !== state.me.id,
  );
  const selected = state.calls.find((call) => call.id === selectedId) ?? mine[0] ?? null;
  const fresh = mine.filter((call) => call.status === "new");

  const markers: MapMarker[] = [];
  for (const house of state.houses) {
    if (house.lat == null || house.lng == null) continue;
    const call = state.calls.find((item) => item.houseId === house.id && item.status !== "closed");
    if (call) {
      markers.push({
        id: `call-${call.id}`,
        lat: house.lat,
        lng: house.lng,
        kind: "call",
        status: call.status,
        color: "#e8a838",
        label: house.name,
      });
    } else {
      markers.push({
        id: `house-${house.id}`,
        lat: house.lat,
        lng: house.lng,
        kind: "house",
        color: areaById.get(house.areaId ?? -1)?.color ?? "#8ea3b5",
        label: house.name,
      });
    }
  }
  if (state.me.lat != null && state.me.lng != null) {
    markers.push({
      id: "me",
      lat: state.me.lat,
      lng: state.me.lng,
      kind: "patrol",
      color: "#e8a838",
      label: "המיקום שלי",
    });
  }
  const shapes: MapShape[] = state.polygons.flatMap((polygon) => {
    const coords = polygon.callIds
      .map((id) => state.calls.find((call) => call.id === id && call.status !== "closed"))
      .filter((call) => call?.house?.lat != null)
      .map((call) => ({ lat: call!.house!.lat as number, lng: call!.house!.lng as number }));
    const shape = coveringShape(coords);
    return shape ? [{ id: polygon.id, confirmed: polygon.confirmed, ...shape }] : [];
  });

  async function toggleActive(active: boolean) {
    let lat: number | undefined;
    let lng: number | undefined;
    if (active && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000 });
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        setGps("on");
      } catch {
        setGps("off");
      }
    }
    if (active && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
    await action("/presence", { body: { active, lat, lng } });
  }

  async function advance(callId: number, status: CallStatus, note?: string) {
    const result = await action(`/calls/${callId}/status`, {
      body: { status, note, lat: state?.me.lat, lng: state?.me.lng },
    });
    if (result && status === "closed") setCloseNote("");
  }

  return (
    <div className="patrol">
      <section className="patrol-panel">
        <div className={`presence ${state.me.isActive ? "is-on" : ""}`}>
          <div>
            <p className="kicker">{state.me.shiftName ?? "בלי משמרת משובצת"}</p>
            <h2>{state.me.isActive ? "אני פעיל" : "אני לא פעיל"}</h2>
            <p>
              {gps === "on" ? "המיקום משודר למוקד" : gps === "off" ? "אין מיקום — השיבוץ יהיה לפי אזור" : "המיקום יתבקש עם המעבר לפעיל"}
            </p>
          </div>
          <button
            type="button"
            className={state.me.isActive ? "btn btn-ghost" : "btn btn-gold"}
            data-testid="active-toggle"
            onClick={() => toggleActive(!state.me.isActive)}
          >
            {state.me.isActive ? "מעבר ללא פעיל" : "אני פעיל"}
          </button>
        </div>
        {state.me.isActive && state.me.onShift === false && (
          <p className="warn">סימנת פעיל, אבל המשמרת שלך לא בתוקף עכשיו. המוקד לא ישלח קריאות חדשות עד תחילת המשמרת.</p>
        )}

        {fresh.map((call) => (
          <article key={call.id} className="alert-card" data-testid="incoming-call">
            <p className="kicker">קריאה חדשה</p>
            <h2>{call.house?.name}</h2>
            <p>{call.house?.address}</p>
            {call.notes && <p>{call.notes}</p>}
            <div className="row-actions">
              {call.house?.phone && <a className="btn btn-ghost" href={`tel:${call.house.phone}`}>חיוג</a>}
              <button type="button" className="btn btn-gold" data-testid="status-received" onClick={() => advance(call.id, "received")}>
                קיבלתי
              </button>
            </div>
          </article>
        ))}

        {selected && selected.status !== "new" && selected.status !== "closed" && selected.assignedPatrolId === state.me.id && (
          <article className="job-card">
            <p className="kicker">הקריאה הנוכחית</p>
            <h2>{selected.house?.name}</h2>
            <p>{selected.house?.address} · {areaById.get(selected.house?.areaId ?? -1)?.name}</p>
            {selected.house?.phone && <a href={`tel:${selected.house.phone}`}>{selected.house.phone}</a>}
            {selected.notes && <p>{selected.notes}</p>}
            {selected.house?.notes && <p className="muted">הערות בית: {selected.house.notes}</p>}
            <p className={statusClass(selected.status)}>{selected.statusLabel}</p>
            {selected.house?.lat != null && selected.house.lng != null && (
              <div className="row-actions">
                <a className="btn btn-gold" href={mapsLink(selected.house.lat, selected.house.lng)} target="_blank" rel="noreferrer">ניווט</a>
                <a className="btn btn-ghost" href={wazeLink(selected.house.lat, selected.house.lng)} target="_blank" rel="noreferrer">Waze</a>
              </div>
            )}
            <div className="status-grid">
              <button type="button" data-testid="status-en-route" disabled={!NEXT_STATUS[selected.status].includes("en_route")} onClick={() => advance(selected.id, "en_route")}>בדרך</button>
              <button type="button" data-testid="status-arrived" disabled={!NEXT_STATUS[selected.status].includes("arrived")} onClick={() => advance(selected.id, "arrived")}>הגעתי</button>
            </div>
            <label className="field">
              הערת סגירה
              <textarea value={closeNote} onChange={(event) => setCloseNote(event.target.value)} rows={2} />
            </label>
            <button type="button" className="btn btn-ghost" data-testid="status-closed" disabled={!NEXT_STATUS[selected.status].includes("closed")} onClick={() => advance(selected.id, "closed", closeNote)}>
              סגירת קריאה
            </button>
          </article>
        )}

        <h3>קריאות שלי</h3>
        <CallList calls={mine} selectedId={selected?.id ?? null} onPick={setSelectedId} />
        <h3>קריאות באזור</h3>
        <CallList calls={areaCalls} selectedId={selected?.id ?? null} onPick={setSelectedId} empty="אין קריאות נוספות באזור" />
      </section>
      <div className="map-pane">
        <MapCanvas
          markers={markers}
          shapes={shapes}
          selectedId={selected ? `call-${selected.id}` : null}
          onSelect={(id) => {
            if (id.startsWith("call-")) setSelectedId(Number(id.slice(5)));
          }}
        />
      </div>
    </div>
  );
}

function CallList({
  calls,
  selectedId,
  onPick,
  empty = "אין קריאות פתוחות",
}: {
  calls: { id: number; status: string; statusLabel: string; house: { name: string; address: string | null } | null; openedAt: string }[];
  selectedId: number | null;
  onPick: (id: number) => void;
  empty?: string;
}) {
  if (!calls.length) return <p className="empty">{empty}</p>;
  return (
    <div className="stack">
      {calls.map((call) => (
        <button key={call.id} type="button" className={`call-row ${selectedId === call.id ? "is-on" : ""}`} onClick={() => onPick(call.id)}>
          <i className={statusClass(call.status)} />
          <span>
            <strong>{call.house?.name}</strong>
            <small>{call.house?.address}</small>
          </span>
          <em className={statusClass(call.status)}>{STATUS_LABEL[call.status as CallStatus] ?? call.statusLabel}</em>
          <time>{formatWhen(call.openedAt)}</time>
        </button>
      ))}
    </div>
  );
}
