"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LayoutDashboard, Settings2, CalendarDays, Zap, LogOut, Users, Workflow } from "lucide-react";
import { logout } from "@/app/login/actions";
import { MobileAvatarMenu } from "./mobile-avatar-menu";

const NAV_PRIMARY = [
  { href: "/app/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/app/inbox", label: "Inbox", Icon: Inbox },
  { href: "/app/agenda", label: "Agenda", Icon: CalendarDays },
];

const NAV_CONFIG: { href: string; label: string; Icon: React.ElementType; mobileHidden?: boolean }[] = [
  { href: "/app/settings/playbook", label: "Configurações", Icon: Settings2, mobileHidden: true },
  { href: "/app/settings/profissionais", label: "Profissionais", Icon: Users, mobileHidden: true },
  { href: "/app/settings/pipeline", label: "Pipeline", Icon: Workflow, mobileHidden: true },
];

type Props = { email?: string; avatarUrl?: string | null };

export function SidebarNav({ email, avatarUrl }: Props) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      {/* Desktop only: brand mark */}
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
        <div className="nav-separator" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "6px 0" }} />
        {NAV_CONFIG.map(({ href, label, Icon, mobileHidden }) => (
          <Link
            key={href}
            href={href}
            className={`side-nav-item${pathname.startsWith(href) ? " active" : ""}${mobileHidden ? " nav-mobile-hidden" : ""}`}
          >
            <Icon size={15} strokeWidth={2} />
            <span className="nav-label">{label}</span>
          </Link>
        ))}
      </nav>

      {/* Desktop only: logout + email footer */}
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

      {/* Mobile only: avatar menu button (rendered last → far right in pill) */}
      <MobileAvatarMenu email={email} avatarUrl={avatarUrl} />
    </aside>
  );
}
