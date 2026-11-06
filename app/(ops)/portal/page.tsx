"use client";

import { PortalApp } from "@/components/PortalApp";
import { RoleGate } from "@/components/Shell";

export default function PortalPage() {
  return (
    <RoleGate allow={["authorized_user"]}>
      <PortalApp />
    </RoleGate>
  );
}
