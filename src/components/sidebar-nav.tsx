"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LayoutDashboard, BookText, Zap } from "lucide-react";

const NAV = [
  { href: "/inbox", label: "Inbox", Icon: Inbox },
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/settings/playbook", label: "Playbook", Icon: BookText },
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

      <div className="sidebar-footer">
        <div className="live-dot" />
        <span className="footer-label">SystemOps</span>
      </div>
    </aside>
  );
}
