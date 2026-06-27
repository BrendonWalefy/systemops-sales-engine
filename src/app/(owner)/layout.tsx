import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { LayoutGrid, LogOut, TrendingUp, Activity } from "lucide-react";
import { logout } from "@/app/login/actions";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { SystemOpsBrand } from "@/components/systemops-brand";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  const email = session?.email ?? "owner";
  return (
    <div className="clinic-layout">
      <aside className="sidebar">
        <div className="brand-block brand-block--owner">
          <div className="brand-mark">
            <SystemOpsBrand variant="icon" className="brand-mark-image" priority />
          </div>
          <div className="brand-copy brand-copy--owner">
            <strong>SystemOps</strong>
            <span>Command Center</span>
          </div>
        </div>

        <div className="owner-sidebar-label">
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
          <Link href="/owner/qualidade" className="side-nav-item">
            <Activity size={15} strokeWidth={2} />
            <span className="nav-label">Qualidade IA</span>
          </Link>
          {/* Logout visível no bottom nav mobile */}
          <form action={logout} className="owner-mobile-logout">
            <button
              type="submit"
              className="side-nav-item"
              style={{ width: "100%", border: "none", cursor: "pointer" }}
            >
              <LogOut size={15} strokeWidth={2} />
              <span className="nav-label">Sair</span>
            </button>
          </form>
        </nav>

        {/* Logout no rodapé da sidebar no desktop */}
        <form action={logout} className="owner-desktop-logout" style={{ marginTop: "auto" }}>
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
          <span
            className="footer-label"
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={email}
          >
            {email}
          </span>
        </div>
      </aside>

      <main style={{ minWidth: 0, overflowX: "hidden" }}>{children}</main>
    </div>
  );
}
