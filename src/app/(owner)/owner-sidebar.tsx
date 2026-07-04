"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LayoutGrid,
  LogOut,
  TrendingUp,
  Activity,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { logout } from "@/app/login/actions";
import { SystemOpsBrand } from "@/components/systemops-brand";
import { haptic } from "@/lib/haptic";

// Mesma chave usada pelo app do cliente (sidebar-nav.tsx) — colapso consistente.
const SIDEBAR_FOCUS_STORAGE_KEY = "systemops-command-center-focus";

export function OwnerSidebar({ email }: { email: string }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsCollapsed(
      window.localStorage.getItem(SIDEBAR_FOCUS_STORAGE_KEY) === "1",
    );
  }, []);

  const toggle = () => {
    haptic("medium");
    setIsCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem(SIDEBAR_FOCUS_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const label = isCollapsed ? "Mostrar Command Center" : "Ocultar Command Center";

  return (
    <>
      <aside className={`sidebar${isCollapsed ? " sidebar-collapsed" : ""}`}>
        <div className="brand-block brand-block--owner">
          <div className="brand-mark">
            <SystemOpsBrand variant="icon" className="brand-mark-image" priority />
          </div>
          <div className="brand-copy brand-copy--owner">
            <strong>SystemOps</strong>
            <span>Command Center</span>
          </div>
          <button
            type="button"
            className="sidebar-collapse-toggle"
            onClick={toggle}
            title={label}
            aria-label={label}
          >
            {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
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
          <Link href="/owner" className="side-nav-item" onClick={() => haptic()} title="Visão geral">
            <LayoutGrid size={15} strokeWidth={2} />
            <span className="nav-label">Visão geral</span>
          </Link>
          <Link href="/owner/financeiro" className="side-nav-item" onClick={() => haptic()} title="Financeiro">
            <TrendingUp size={15} strokeWidth={2} />
            <span className="nav-label">Financeiro</span>
          </Link>
          <Link href="/owner/qualidade" className="side-nav-item" onClick={() => haptic()} title="Qualidade IA">
            <Activity size={15} strokeWidth={2} />
            <span className="nav-label">Qualidade IA</span>
          </Link>
          <form action={logout} className="owner-mobile-logout">
            <button
              type="submit"
              className="side-nav-item"
              style={{ width: "100%", border: "none", cursor: "pointer" }}
              title="Sair"
            >
              <LogOut size={15} strokeWidth={2} />
              <span className="nav-label">Sair</span>
            </button>
          </form>
        </nav>

        <form action={logout} className="owner-desktop-logout" style={{ marginTop: "auto" }}>
          <button
            type="submit"
            className="side-nav-item"
            style={{ width: "100%", border: "none", cursor: "pointer" }}
            title="Sair"
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

      <button
        type="button"
        className={`sidebar-focus-restore${isCollapsed ? " visible" : ""}`}
        onClick={toggle}
        aria-label="Mostrar Command Center"
        title="Mostrar Command Center"
      >
        <PanelLeftOpen size={16} />
      </button>
    </>
  );
}
