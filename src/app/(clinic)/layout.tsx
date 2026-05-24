import type { ReactNode } from "react";
import { SidebarNav } from "@/components/sidebar-nav";

export default function ClinicLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "100vh" }}>
      <SidebarNav />
      <main style={{ minWidth: 0, overflowX: "hidden" }}>{children}</main>
    </div>
  );
}
