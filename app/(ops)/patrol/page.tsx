"use client";

import { PatrolApp } from "@/components/PatrolApp";
import { RoleGate } from "@/components/Shell";

export default function PatrolPage() {
  return (
    <RoleGate allow={["patrol"]}>
      <PatrolApp />
    </RoleGate>
  );
}
