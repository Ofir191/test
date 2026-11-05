import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieName, readSession } from "@/lib/auth.mjs";
import { getDb, q } from "@/lib/db.mjs";
import { homeFor, type Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const jar = await cookies();
  const token = jar.get(cookieName())?.value;
  const session = token ? readSession(token) : null;
  if (!session) redirect("/login");
  const db = await getDb();
  const user = q(db).get(`SELECT role FROM users WHERE id = ? AND active = 1`, session.uid) as { role: Role } | null;
  if (!user) redirect("/login");
  redirect(homeFor(user.role));
}
