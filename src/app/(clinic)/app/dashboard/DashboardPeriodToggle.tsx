"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const PERIODS = [
  { key: "1d", label: "1D" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
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
