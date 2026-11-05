"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useOps } from "./OpsProvider";
import { formatClock, formatWhen } from "@/lib/format";
import { ROLE_LABEL, homeFor, type Role } from "@/lib/types";

const LINKS: { href: string; label: string; roles: Role[] }[] = [
  { href: "/dispatch", label: "מוקד", roles: ["admin", "dispatcher"] },
  { href: "/admin", label: "ניהול", roles: ["admin"] },
  { href: "/reports", label: "דוחות", roles: ["admin", "dispatcher"] },
  { href: "/patrol", label: "סיור", roles: ["patrol"] },
  { href: "/portal", label: "הקריאות שלי", roles: ["authorized_user"] },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { state, error, clearError, connected, muted, toggleMute, action } = useOps();
  const pathname = usePathname();
  const router = useRouter();
  const [clock, setClock] = useState("");
  const [openNotes, setOpenNotes] = useState(false);

  useEffect(() => {
    const tick = () => setClock(formatClock());
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  if (!state) {
    return (
      <div className="boot">
        <div className="mark">מ</div>
        <p>טוען את המוקד…</p>
      </div>
    );
  }

  const unread = state.notifications.filter((notice) => !notice.read);
  const links = LINKS.filter((link) => link.roles.includes(state.me.role));

  return (
    <div className="app-frame">
      <header className="topbar">
        <Link href={homeFor(state.me.role)} className="brand">
          <span className="mark">מ</span>
          <span>
            <strong>משמר</strong>
            <small>קריאות וסיורים</small>
          </span>
        </Link>
        <nav className="nav">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={pathname === link.href ? "is-on" : ""}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="top-tools">
          <span className={connected ? "live" : "live is-off"}>{connected ? "חי" : "מתחדש"}</span>
          <time>{clock}</time>
          <button type="button" className="icon-btn" onClick={toggleMute} aria-pressed={muted}>
            {muted ? "שקט" : "צליל"}
          </button>
          <button type="button" className="icon-btn notes-btn" onClick={() => setOpenNotes((value) => !value)}>
            התראות
            {unread.length > 0 && <em>{unread.length}</em>}
          </button>
          <span className="who">
            <strong>{state.me.fullName}</strong>
            <small>{ROLE_LABEL[state.me.role]}</small>
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              router.replace("/login");
            }}
          >
            יציאה
          </button>
        </div>
      </header>
      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={clearError}>סגירה</button>
        </div>
      )}
      {openNotes && (
        <div className="note-panel">
          {state.notifications.length === 0 && <p className="muted">אין התראות</p>}
          {state.notifications.map((notice) => (
            <button
              key={notice.id}
              type="button"
              className={notice.read ? "note" : "note is-new"}
              onClick={async () => {
                await action("/notifications/read", { body: { ids: [notice.id] } });
                if (notice.callId) {
                  window.dispatchEvent(new CustomEvent("mishmar-open-call", { detail: notice.callId }));
                }
                setOpenNotes(false);
              }}
            >
              <strong>{notice.title}</strong>
              <span>{notice.body}</span>
              <small>{formatWhen(notice.createdAt)}</small>
            </button>
          ))}
          {unread.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => action("/notifications/read", { body: {} })}>
              סמן הכל כנקרא
            </button>
          )}
        </div>
      )}
      <main className="workspace">{children}</main>
    </div>
  );
}

export function RoleGate({ allow, children }: { allow: Role[]; children: React.ReactNode }) {
  const { state } = useOps();
  const router = useRouter();
  useEffect(() => {
    if (state && !allow.includes(state.me.role)) router.replace(homeFor(state.me.role));
  }, [state, allow, router]);
  if (!state || !allow.includes(state.me.role)) return null;
  return children;
}
