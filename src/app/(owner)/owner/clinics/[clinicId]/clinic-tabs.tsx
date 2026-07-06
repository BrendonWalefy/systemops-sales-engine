"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

export type ClinicTab = "implantacao" | "operacao" | "config";

interface ClinicTabsProps {
  defaultTab: ClinicTab;
  tabImplantacao: React.ReactNode;
  tabOperacao: React.ReactNode;
  tabConfig: React.ReactNode;
}

const TAB_LABELS: Record<ClinicTab, string> = {
  implantacao: "Implantação",
  operacao: "Operação",
  config: "Configuração",
};

export function ClinicTabs({ defaultTab, tabImplantacao, tabOperacao, tabConfig }: ClinicTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const validTabs: ClinicTab[] = ["implantacao", "operacao", "config"];
  const rawTab = searchParams.get("tab");
  const activeTab: ClinicTab =
    rawTab && validTabs.includes(rawTab as ClinicTab)
      ? (rawTab as ClinicTab)
      : defaultTab;

  const panels: Record<ClinicTab, React.ReactNode> = {
    implantacao: tabImplantacao,
    operacao: tabOperacao,
    config: tabConfig,
  };

  const setTab = useCallback(
    (tab: ClinicTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tab);
      // Clear flash params on tab switch to avoid stale messages
      ["memberOk", "memberError", "planOk", "channelSafetyOk", "channelSafetyError", "goLiveOk", "goLiveError"].forEach(
        (p) => params.delete(p),
      );
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Seções da clínica"
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--line)",
          paddingBottom: 0,
        }}
      >
        {validTabs.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab}`}
              id={`tab-${tab}`}
              onClick={() => setTab(tab)}
              style={{
                background: "none",
                border: "none",
                borderBottom: isActive
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                color: isActive ? "var(--text)" : "var(--muted)",
                fontSize: 13,
                fontWeight: isActive ? 700 : 500,
                padding: "8px 14px",
                cursor: "pointer",
                transition: "color 0.15s, border-color 0.15s",
                marginBottom: -1,
                whiteSpace: "nowrap",
                fontFamily: "inherit",
              }}
            >
              {TAB_LABELS[tab]}
            </button>
          );
        })}
      </div>

      {/* Tab panels */}
      {validTabs.map((tab) => (
        <div
          key={tab}
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          style={{ display: activeTab === tab ? "grid" : "none", gap: 16 }}
        >
          {panels[tab]}
        </div>
      ))}
    </div>
  );
}
