import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { OwnerSidebar } from "./owner-sidebar";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  const email = session?.email ?? "owner";
  return (
    <div className="clinic-layout">
      <OwnerSidebar email={email} />
      <main style={{ minWidth: 0, overflowX: "hidden" }}>{children}</main>
    </div>
  );
}
