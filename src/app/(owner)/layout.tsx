import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { Zap, LayoutGrid, LogOut, TrendingUp } from "lucide-react";
import { logout } from "@/app/login/actions";
import { verifyToken, COOKIE_NAME } from "@/lib/session";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  const email = session?.email ?? "owner";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "100vh" }}>
      <aside className="sidebar">
        <div className="brand-mark">
          <Zap size={18} strokeWidth={2.5} />
        </div>

        <div style={{ padding: "0 12px 8px", marginBottom: 4 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--accent-strong)",
              opacity: 0.8,
            }}
          >
            Owner
          </span>
        </div>

        <nav className="side-nav">
          <Link href="/owner" className="side-nav-item">
            <LayoutGrid size={15} strokeWidth={2} />
            <span className="nav-label">Visão geral</span>
          </Link>
          <Link href="/owner/financeiro" className="side-nav-item">
            <TrendingUp size={15} strokeWidth={2} />
            <span className="nav-label">Financeiro</span>
          </Link>
        </nav>

        <form action={logout} style={{ marginTop: "auto" }}>
          <button
            type="submit"
            className="side-nav-item"
            style={{ width: "100%", border: "none", cursor: "pointer" }}
          >
            <LogOut size={15} strokeWidth={2} />
            <span className="nav-label">Sair</span>
          </button>
        </form>

        <div className="sidebar-footer">
          <div className="live-dot" />
          <span className="footer-label" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={email}>{email}</span>
        </div>
      </aside>

      <main style={{ minWidth: 0, overflowX: "hidden" }}>{children}</main>
    </div>
  );
}
