"use client";

import { ReportsApp } from "@/components/ReportsApp";
import { RoleGate } from "@/components/Shell";

export default function ReportsPage() {
  return (
    <RoleGate allow={["admin", "dispatcher"]}>
      <ReportsApp />
    </RoleGate>
  );
}
