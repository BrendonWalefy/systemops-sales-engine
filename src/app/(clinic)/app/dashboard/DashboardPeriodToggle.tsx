"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const PERIODS = [
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "3m", label: "3 meses" },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"];

export function DashboardPeriodToggle({ current }: { current: PeriodKey }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleChange = useCallback(
    (key: PeriodKey) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("period", key);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <div className="dashboard-period-toggle">
      {PERIODS.map(({ key, label }) => (
        <button
          key={key}
          className={`dashboard-period-btn${current === key ? " active" : ""}`}
          onClick={() => handleChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
