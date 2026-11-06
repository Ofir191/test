"use client";

import { useEffect, useState } from "react";
import { daysAgoInputValue, formatMinutes, formatWhen, todayInputValue } from "@/lib/format";
import { jerusalemDayEnd, jerusalemDayStart } from "@/lib/time.mjs";
import { STATUS_LABEL, type CallStatus } from "@/lib/types";
import { useOps } from "./OpsProvider";

type Report = {
  total: number;
  byStatus: Record<string, number>;
  byDay: { date: string; count: number }[];
  byArea: { name: string; count: number }[];
  byPatrol: { name: string; count: number }[];
  avgMinutesToReceive: number | null;
  avgMinutesToArrive: number | null;
  avgMinutesToClose: number | null;
  rows: {
    id: number;
    openedAt: string;
    statusLabel: string;
    house: string;
    address: string | null;
    area: string | null;
    patrol: string | null;
    minutesToReceive: number | null;
    minutesToArrive: number | null;
    minutesToClose: number | null;
  }[];
};

export function ReportsApp() {
  const { state } = useOps();
  const [fromDay, setFromDay] = useState(daysAgoInputValue(30));
  const [toDay, setToDay] = useState(todayInputValue());
  const [areaId, setAreaId] = useState("");
  const [patrolId, setPatrolId] = useState("");
  const [status, setStatus] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (fromDay) params.set("from", jerusalemDayStart(fromDay));
    if (toDay) params.set("to", jerusalemDayEnd(toDay));
    if (areaId) params.set("areaId", areaId);
    if (patrolId) params.set("patrolId", patrolId);
    if (status) params.set("status", status);
    const query = params.toString();
    let cancelled = false;
    fetch(`/api/reports?${query}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "לא הצלחתי לטעון דוח");
        if (!cancelled) {
          setReport(data);
          setError("");
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [fromDay, toDay, areaId, patrolId, status]);

  if (!state) return null;
  const max = Math.max(...(report?.byDay.map((day) => day.count) ?? [1]), 1);
  const exportParams = new URLSearchParams();
  if (fromDay) exportParams.set("from", jerusalemDayStart(fromDay));
  if (toDay) exportParams.set("to", jerusalemDayEnd(toDay));
  if (areaId) exportParams.set("areaId", areaId);
  if (patrolId) exportParams.set("patrolId", patrolId);
  if (status) exportParams.set("status", status);

  return (
    <div className="reports">
      <header className="page-intro">
        <p className="kicker">דוחות</p>
        <h2>היסטוריית קריאות</h2>
      </header>
      <div className="filters">
        <label className="field">מתאריך<input type="date" value={fromDay} onChange={(event) => setFromDay(event.target.value)} /></label>
        <label className="field">עד תאריך<input type="date" value={toDay} onChange={(event) => setToDay(event.target.value)} /></label>
        <label className="field">אזור
          <select value={areaId} onChange={(event) => setAreaId(event.target.value)}>
            <option value="">הכל</option>
            {state.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
        </label>
        <label className="field">סייר
          <select value={patrolId} onChange={(event) => setPatrolId(event.target.value)}>
            <option value="">הכל</option>
            {state.patrols.map((patrol) => <option key={patrol.id} value={patrol.id}>{patrol.fullName}</option>)}
          </select>
        </label>
        <label className="field">סטטוס
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">הכל</option>
            {(Object.keys(STATUS_LABEL) as CallStatus[]).map((key) => <option key={key} value={key}>{STATUS_LABEL[key]}</option>)}
          </select>
        </label>
        <a className="btn btn-gold" href={`/api/reports/export?${exportParams.toString()}`}>ייצוא CSV</a>
      </div>
      {error && <p className="warn">{error}</p>}
      {report && (
        <>
          <div className="stats">
            <article><b>{report.total}</b><span>קריאות</span></article>
            <article><b>{formatMinutes(report.avgMinutesToReceive)}</b><span>ממוצע עד קבלה</span></article>
            <article><b>{formatMinutes(report.avgMinutesToArrive)}</b><span>ממוצע עד הגעה</span></article>
            <article><b>{formatMinutes(report.avgMinutesToClose)}</b><span>ממוצע עד סגירה</span></article>
          </div>
          <div className="report-grid">
            <section>
              <h3>לפי יום</h3>
              <div className="bars">
                {report.byDay.map((day) => (
                  <div key={day.date} className="bar-col">
                    <i style={{ height: `${Math.max(8, (day.count / max) * 120)}px` }} />
                    <small>{day.date.slice(5)}</small>
                  </div>
                ))}
                {report.byDay.length === 0 && <p className="empty">אין נתונים בטווח</p>}
              </div>
            </section>
            <section>
              <h3>לפי אזור</h3>
              {report.byArea.map((item) => <p key={item.name}>{item.name} <b>{item.count}</b></p>)}
              <h3>לפי סייר</h3>
              {report.byPatrol.map((item) => <p key={item.name}>{item.name} <b>{item.count}</b></p>)}
            </section>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>מס׳</th><th>נפתחה</th><th>בית</th><th>אזור</th><th>סייר</th><th>סטטוס</th><th>עד קבלה</th><th>עד הגעה</th><th>עד סגירה</th></tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{formatWhen(row.openedAt)}</td>
                    <td>{row.house}<small>{row.address}</small></td>
                    <td>{row.area ?? "—"}</td>
                    <td>{row.patrol ?? "—"}</td>
                    <td>{row.statusLabel}</td>
                    <td>{formatMinutes(row.minutesToReceive)}</td>
                    <td>{formatMinutes(row.minutesToArrive)}</td>
                    <td>{formatMinutes(row.minutesToClose)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
