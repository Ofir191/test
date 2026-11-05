"use client";

import { DispatchBoard } from "@/components/DispatchBoard";
import { RoleGate } from "@/components/Shell";

export default function DispatchPage() {
  return (
    <RoleGate allow={["admin", "dispatcher"]}>
      <DispatchBoard />
    </RoleGate>
  );
}
