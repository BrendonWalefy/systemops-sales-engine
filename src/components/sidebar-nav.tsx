"use client";
import React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Inbox, Home, Settings2, CalendarDays, LogOut, Users, Workflow, Plus, LayoutGrid, RefreshCw, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { logout } from "@/app/login/actions";
import { MobileAvatarMenu } from "./mobile-avatar-menu";
import { BellToggle } from "./bell-toggle";
import { haptic } from "@/lib/haptic";
import { SystemOpsBrand } from "./systemops-brand";

const NAV_ITEMS: { href: string; label: string; Icon: React.ElementType; mobileHidden?: boolean }[] = [
  { href: "/app/dashboard", label: "Início", Icon: Home },
  { href: "/app/inbox", label: "Inbox", Icon: Inbox },
  { href: "/app/agenda", label: "Agenda", Icon: CalendarDays },
  { href: "/app/settings/pipeline", label: "Pipeline", Icon: Workflow, mobileHidden: true },
  { href: "/app/inbox?filter=recovery", label: "Recuperação", Icon: RefreshCw, mobileHidden: true },
  { href: "/app/settings/profissionais", label: "Profissionais", Icon: Users, mobileHidden: true },
  { href: "/app/settings/playbook", label: "Configurações", Icon: Settings2, mobileHidden: true },
];

type Props = { email?: string; avatarUrl?: string | null; inboxBadge?: number; isOwner?: boolean; clinicName?: string };
const SIDEBAR_FOCUS_STORAGE_KEY = "systemops-command-center-focus";

function initials(value: string | undefined): string {
  if (!value) return "SO";
  return value
    .split(/[.\s@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "SO";
}

function SidebarNavInner({ email, avatarUrl, inboxBadge = 0, isOwner = false, clinicName = "SystemOps" }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  React.useEffect(() => {
    const routes = [
      ...NAV_ITEMS.map((item) => item.href),
      "/app/agenda?new=1",
      "/app/settings/equipe",
    ];
    for (const route of routes) {
      router.prefetch(route);
    }
  }, [router]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsCollapsed(window.localStorage.getItem(SIDEBAR_FOCUS_STORAGE_KEY) === "1");
  }, []);

  const activeFor = (href: string) => {
    const [path, query = ""] = href.split("?");
    const isRecovery = path === "/app/inbox" && query.includes("filter=recovery");
    if (isRecovery) return pathname === "/app/inbox" && searchParams.get("filter") === "recovery";
    if (path === "/app/inbox") return pathname === "/app/inbox" && searchParams.get("filter") !== "recovery";
    return pathname.startsWith(path);
  };

  const toggleCollapsed = () => {
    haptic("medium");
    setIsCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem(SIDEBAR_FOCUS_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const collapseLabel = isCollapsed ? "Mostrar Command Center" : "Ocultar Command Center";

  return (
    <>
    <aside className={`sidebar${isCollapsed ? " sidebar-collapsed" : ""}`}>
      <div className="brand-block">
        <div className="brand-mark">
          <SystemOpsBrand variant="icon" className="brand-mark-image" priority />
        </div>
        <div className="brand-copy">
          <strong>SystemOps</strong>
          <span>Command Center</span>
        </div>
        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={toggleCollapsed}
          title={collapseLabel}
          aria-label={collapseLabel}
        >
          {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="side-nav">
        {isOwner && (
          <>
            <Link
              href="/owner"
              onClick={() => haptic()}
              className="side-nav-item nav-mobile-hidden"
              style={{ color: "#818cf8" }}
              title="Owner"
            >
              <LayoutGrid size={15} strokeWidth={2} />
              <span className="nav-label">Owner</span>
            </Link>
            <div className="nav-separator" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "4px 0" }} />
          </>
        )}
        {NAV_ITEMS.slice(0, 2).map(({ href, label, Icon, mobileHidden }) => (
          <Link
            key={href}
            href={href}
            prefetch
            onClick={() => haptic()}
            className={`side-nav-item${activeFor(href) ? " active" : ""}${mobileHidden ? " nav-mobile-hidden" : ""}`}
            title={label}
          >
            <span className="nav-icon-wrap">
              <Icon size={15} strokeWidth={2} />
              {href === "/app/inbox" && inboxBadge > 0 && <span className="nav-inbox-dot" />}
            </span>
            <span className="nav-label">{label}</span>
            {href === "/app/inbox" && inboxBadge > 0 && <span className="nav-count">{inboxBadge}</span>}
          </Link>
        ))}
        <Link
          href="/app/agenda?new=1"
          prefetch
          onClick={() => haptic("medium")}
          className="mobile-novo-btn"
          aria-label="Novo agendamento"
          title="Novo agendamento"
        >
          <Plus size={20} strokeWidth={2.5} />
          <span className="nav-label">Novo</span>
        </Link>
        {NAV_ITEMS.slice(2).map(({ href, label, Icon, mobileHidden }) => (
          <Link
            key={href}
            href={href}
            prefetch
            onClick={() => haptic()}
            className={`side-nav-item${activeFor(href) ? " active" : ""}${mobileHidden ? " nav-mobile-hidden" : ""}`}
            title={label}
          >
            <Icon size={15} strokeWidth={2} />
            <span className="nav-label">{label}</span>
          </Link>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <form action={logout}>
          <button
            type="submit"
            onClick={() => haptic("medium")}
            className="side-nav-item"
            style={{ width: "100%", border: "none", cursor: "pointer" }}
            title="Sair"
          >
            <LogOut size={15} strokeWidth={2} />
            <span className="nav-label">Sair</span>
          </button>
        </form>

        <div className="sidebar-footer">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL dinâmica do Vercel Blob, sem domain configurado em next.config
            <img src={avatarUrl} alt="Avatar" className="sidebar-account-avatar sidebar-account-avatar-img" />
          ) : (
            <div className="sidebar-account-avatar">{initials(clinicName)}</div>
          )}
          <span className="footer-label" title={`${clinicName} · ${email ?? "SystemOps"}`}>
            <strong>{clinicName}</strong>
            <small>{email ?? "SystemOps"}</small>
          </span>
          <BellToggle />
        </div>
      </div>

      <MobileAvatarMenu email={email} avatarUrl={avatarUrl} settingsMode isOwner={isOwner} />
    </aside>
    <button
      type="button"
      className={`sidebar-focus-restore${isCollapsed ? " visible" : ""}`}
      onClick={toggleCollapsed}
      aria-label="Mostrar Command Center"
      title="Mostrar Command Center"
    >
      <PanelLeftOpen size={16} />
    </button>
    </>
  );
}

export function SidebarNav(props: Props) {
  return (
    <React.Suspense fallback={<aside className="sidebar" />}>
      <SidebarNavInner {...props} />
    </React.Suspense>
  );
}
