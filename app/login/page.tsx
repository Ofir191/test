"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { homeFor, type Role } from "@/lib/types";

const DEMOS: { role: string; email: string; password: string }[] = [
  { role: "מנהלת מערכת", email: "admin@mishmar.local", password: "Admin1234" },
  { role: "מוקדן", email: "dispatch@mishmar.local", password: "Dispatch1234" },
  { role: "סייר פעיל", email: "avi@mishmar.local", password: "Patrol1234" },
  { role: "סיירת לא פעילה", email: "michal@mishmar.local", password: "Patrol1234" },
  { role: "בעלת בית", email: "ronit@mishmar.local", password: "Resident1234" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("dispatch@mishmar.local");
  const [password, setPassword] = useState("Dispatch1234");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user?.role) router.replace(homeFor(data.user.role as Role));
      })
      .catch(() => undefined);
  }, [router]);

  async function submit(nextEmail = email, nextPassword = password) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: nextEmail, password: nextPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "ההתחברות נכשלה");
      return;
    }
    router.replace(homeFor(data.user.role as Role));
  }

  return (
    <main className="login">
      <section className="login-copy">
        <div className="mark">מ</div>
        <h1>משמר</h1>
        <p>פתיחת קריאה, שיבוץ הסייר הפעיל באזור, ומעקב עד הסגירה. קריאות קרובות נאספות לפוליגון אחד.</p>
      </section>
      <form
        className="login-card"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2>כניסה</h2>
        <label className="field">
          אימייל
          <input data-testid="login-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="field">
          סיסמה
          <input data-testid="login-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        {error && <p className="warn">{error}</p>}
        <button className="btn btn-gold" data-testid="login-submit" disabled={busy} type="submit">
          {busy ? "נכנס…" : "כניסה"}
        </button>
        <div className="demo">
          <p className="muted">חשבונות הדגמה</p>
          {DEMOS.map((demo) => (
            <button
              key={demo.email}
              type="button"
              onClick={() => {
                setEmail(demo.email);
                setPassword(demo.password);
                submit(demo.email, demo.password);
              }}
            >
              <strong>{demo.role}</strong>
              <small className="muted">{demo.email}</small>
            </button>
          ))}
        </div>
      </form>
    </main>
  );
}
