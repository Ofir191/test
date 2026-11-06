"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OpsState } from "@/lib/types";

type ActionOptions = { method?: string; body?: unknown; form?: FormData };

type OpsContextValue = {
  state: OpsState | null;
  error: string | null;
  connected: boolean;
  muted: boolean;
  clearError: () => void;
  toggleMute: () => void;
  reload: () => Promise<void>;
  action: (path: string, options?: ActionOptions) => Promise<Record<string, unknown> | null>;
};

const Ctx = createContext<OpsContextValue | null>(null);

function beep() {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(740, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + 0.18);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.24);
  oscillator.onended = () => ctx.close();
}

export function OpsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<OpsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const seen = useRef<Set<number> | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    const res = await fetch("/api/state", { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      if (id === seq.current) setError(data?.error || "לא הצלחתי לטעון את הנתונים");
      return;
    }
    if (id === seq.current) setState(data);
  }, [router]);

  const action = useCallback(async (path: string, options?: ActionOptions) => {
    try {
      const res = await fetch(`/api${path}`, {
        method: options?.method ?? (options?.form || options?.body ? "POST" : "GET"),
        headers: options?.form || options?.body == null ? undefined : { "content-type": "application/json" },
        body: options?.form ?? (options?.body != null ? JSON.stringify(options.body) : undefined),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.replace("/login");
        return null;
      }
      if (!res.ok) {
        setError(data.error || "הפעולה נכשלה");
        return null;
      }
      if (data.state) setState(data.state);
      setError(null);
      return data;
    } catch {
      setError("אין חיבור לשרת");
      return null;
    }
  }, [router]);

  useEffect(() => {
    setMuted(localStorage.getItem("mishmar-mute") === "1");
    load();
    const source = new EventSource("/api/stream");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "changed") load();
    };
    const poll = setInterval(load, 12000);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => {
      source.close();
      clearInterval(poll);
    };
  }, [load]);

  useEffect(() => {
    if (!state) return;
    const ids = state.notifications.map((notice) => notice.id);
    if (seen.current == null) {
      seen.current = new Set(ids);
      return;
    }
    const fresh = state.notifications.filter((notice) => !notice.read && !seen.current?.has(notice.id));
    for (const id of ids) seen.current.add(id);
    if (!fresh.length) return;
    if (!muted) {
      try {
        beep();
      } catch {
        /* autoplay blocked until a gesture */
      }
    }
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const notice = fresh[0];
      new Notification(notice.title, { body: notice.body, lang: "he" });
    }
  }, [state, muted]);

  const value = useMemo<OpsContextValue>(() => ({
    state,
    error,
    connected,
    muted,
    clearError: () => setError(null),
    toggleMute: () => {
      setMuted((current) => {
        localStorage.setItem("mishmar-mute", current ? "0" : "1");
        return !current;
      });
    },
    reload: load,
    action,
  }), [state, error, connected, muted, load, action]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOps() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useOps מחוץ לספק");
  return value;
}
