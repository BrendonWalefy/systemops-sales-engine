import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { SidebarNav } from "@/components/sidebar-nav";
import { verifyToken, COOKIE_NAME } from "@/lib/session";

export default async function ClinicLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "100vh" }}>
      <SidebarNav email={session?.email} />
      <main style={{ minWidth: 0, overflowX: "hidden" }}>{children}</main>
    </div>
  );
}
