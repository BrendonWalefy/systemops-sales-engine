"use client";
import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Inbox, Home, Settings2, CalendarDays, Zap, LogOut, Users, Workflow, Plus, LayoutGrid } from "lucide-react";
import { logout } from "@/app/login/actions";
import { MobileAvatarMenu } from "./mobile-avatar-menu";
import { BellToggle } from "./bell-toggle";
import { haptic } from "@/lib/haptic";

const NAV_PRIMARY = [
  { href: "/app/dashboard", label: "Inicio", Icon: Home },
  { href: "/app/inbox", label: "Inbox", Icon: Inbox },
  { href: "/app/agenda", label: "Agenda", Icon: CalendarDays },
];

const NAV_CONFIG: { href: string; label: string; Icon: React.ElementType; mobileHidden?: boolean }[] = [
  { href: "/app/settings/playbook", label: "Configurações", Icon: Settings2, mobileHidden: true },
  { href: "/app/settings/profissionais", label: "Profissionais", Icon: Users, mobileHidden: true },
  { href: "/app/settings/pipeline", label: "Pipeline", Icon: Workflow, mobileHidden: true },
];

type Props = { email?: string; avatarUrl?: string | null; inboxBadge?: number; isOwner?: boolean };

export function SidebarNav({ email, avatarUrl, inboxBadge = 0, isOwner = false }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    const routes = [
      ...NAV_PRIMARY.map((item) => item.href),
      "/app/agenda?new=1",
      ...NAV_CONFIG.map((item) => item.href),
      "/app/settings/equipe",
    ];

    for (const route of routes) {
      router.prefetch(route);
    }
  }, [router]);

  return (
    <aside className="sidebar">
      {/* Desktop only: brand mark */}
      <div className="brand-mark">
        <Zap size={18} strokeWidth={2.5} />
      </div>

      <nav className="side-nav">
        {isOwner && (
          <>
            <Link
              href="/owner"
              onClick={() => haptic()}
              className="side-nav-item"
              style={{ color: "#818cf8" }}
            >
              <LayoutGrid size={15} strokeWidth={2} />
              <span className="nav-label">Owner</span>
            </Link>
            <div className="nav-separator" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "4px 0" }} />
          </>
        )}
        {NAV_PRIMARY.slice(0, 1).map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            prefetch
            onClick={() => haptic()}
            className={`side-nav-item${pathname.startsWith(href) ? " active" : ""}`}
          >
            <Icon size={15} strokeWidth={2} />
            <span className="nav-label">{label}</span>
          </Link>
        ))}
        {/* Inbox with badge */}
        <Link
          href="/app/inbox"
          prefetch
          onClick={() => haptic()}
          className={`side-nav-item${pathname.startsWith("/app/inbox") ? " active" : ""}`}
        >
          <span className="nav-icon-wrap">
            <Inbox size={15} strokeWidth={2} />
            {inboxBadge > 0 && <span className="nav-inbox-dot" />}
          </span>
          <span className="nav-label">Inbox</span>
        </Link>
        <Link
          href="/app/agenda?new=1"
          prefetch
          onClick={() => haptic("medium")}
          className="mobile-novo-btn"
          aria-label="Novo agendamento"
        >
          <Plus size={22} strokeWidth={2.5} />
          <span className="nav-label">Novo</span>
        </Link>
        {NAV_PRIMARY.slice(2).map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            prefetch
            onClick={() => haptic()}
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
            prefetch
            onClick={() => haptic()}
            className={`side-nav-item${pathname.startsWith(href) ? " active" : ""}${mobileHidden ? " nav-mobile-hidden" : ""}`}
          >
            <Icon size={15} strokeWidth={2} />
            <span className="nav-label">{label}</span>
          </Link>
        ))}
      </nav>

      {/* Desktop only: logout + email footer */}
      <div className="sidebar-bottom">
        <form action={logout}>
          <button
            type="submit"
            onClick={() => haptic("medium")}
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
          <BellToggle />
        </div>
      </div>

      {/* Mobile only: settings/avatar menu (rendered last → far right in pill) */}
      <MobileAvatarMenu email={email} avatarUrl={avatarUrl} settingsMode isOwner={isOwner} />
    </aside>
  );
}
