"use client";

import { OpsProvider } from "@/components/OpsProvider";
import { Shell } from "@/components/Shell";

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <OpsProvider>
      <Shell>{children}</Shell>
    </OpsProvider>
  );
}
