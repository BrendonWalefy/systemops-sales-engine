"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LayoutDashboard, Settings2, CalendarDays, Zap, LogOut, Users } from "lucide-react";
import { logout } from "@/app/login/actions";

const NAV_PRIMARY = [
  { href: "/app/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/app/inbox", label: "Inbox", Icon: Inbox },
  { href: "/app/agenda", label: "Agenda", Icon: CalendarDays },
];

const NAV_CONFIG = [
  { href: "/app/settings/playbook", label: "Configurações", Icon: Settings2 },
  { href: "/app/settings/profissionais", label: "Profissionais", Icon: Users },
];

export function SidebarNav({ email }: { email?: string }) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="brand-mark">
        <Zap size={18} strokeWidth={2.5} />
      </div>

      <nav className="side-nav">
        {NAV_PRIMARY.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={`side-nav-item${pathname.startsWith(href) ? " active" : ""}`}
          >
            <Icon size={15} strokeWidth={2} />
            <span className="nav-label">{label}</span>
          </Link>
        ))}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "6px 0" }} />
        {NAV_CONFIG.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={`side-nav-item${pathname.startsWith(href) ? " active" : ""}`}
          >
            <Icon size={15} strokeWidth={2} />
            <span className="nav-label">{label}</span>
          </Link>
        ))}
      </nav>

      <div className="sidebar-bottom" style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        <form action={logout}>
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
          <span className="footer-label" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={email}>{email ?? "SystemOps"}</span>
        </div>
      </div>
    </aside>
  );
}
