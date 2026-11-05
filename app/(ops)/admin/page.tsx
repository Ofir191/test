"use client";

import { AdminApp } from "@/components/AdminApp";
import { RoleGate } from "@/components/Shell";

export default function AdminPage() {
  return (
    <RoleGate allow={["admin"]}>
      <AdminApp />
    </RoleGate>
  );
}
