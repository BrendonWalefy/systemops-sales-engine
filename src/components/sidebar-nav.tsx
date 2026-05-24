"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LayoutDashboard, BookText, Zap, LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";

const NAV = [
  { href: "/app/inbox", label: "Inbox", Icon: Inbox },
  { href: "/app/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/app/settings/playbook", label: "Playbook", Icon: BookText },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="brand-mark">
        <Zap size={18} strokeWidth={2.5} />
      </div>

      <nav className="side-nav">
        {NAV.map(({ href, label, Icon }) => (
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
        <span className="footer-label">SystemOps</span>
      </div>
    </aside>
  );
}
