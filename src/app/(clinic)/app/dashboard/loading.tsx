export default function DashboardLoading() {
  return (
    <div>
      <div className="product-topbar">
        <div>
          <div className="skeleton" style={{ width: 110, height: 28, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 200, height: 16 }} />
        </div>
      </div>

      {/* KPI strip */}
      <div className="kpi-strip">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="metric">
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <div className="skeleton" style={{ width: 20, height: 20, borderRadius: 4 }} />
              <div className="skeleton" style={{ width: 100, height: 13 }} />
            </div>
            <div className="skeleton" style={{ width: 56, height: 32, marginBottom: 6 }} />
            <div className="skeleton" style={{ width: 90, height: 12 }} />
          </div>
        ))}
      </div>

      <div style={{ padding: "0 30px 24px", display: "grid", gap: 24 }}>
        {/* Table skeleton */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-soft)" }}>
            <div className="skeleton" style={{ width: 110, height: 13 }} />
          </div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div className="skeleton" style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0 }} />
                <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: 5 }}>
                  <div className="skeleton" style={{ width: "60%", height: 13 }} />
                  <div className="skeleton" style={{ width: "40%", height: 12 }} />
                </div>
                <div className="skeleton" style={{ flex: 1, height: 13 }} />
                <div className="skeleton" style={{ width: 60, height: 22, borderRadius: 999 }} />
                <div className="skeleton" style={{ width: 72, height: 22, borderRadius: 999 }} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
                  <div className="skeleton" style={{ width: 80, height: 13 }} />
                  <div className="skeleton" style={{ width: 50, height: 11 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Temperature cards */}
        <div>
          <div className="skeleton" style={{ width: 160, height: 12, marginBottom: 12 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="metric">
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  <div className="skeleton" style={{ width: 20, height: 20, borderRadius: 4 }} />
                  <div className="skeleton" style={{ width: 60, height: 13 }} />
                </div>
                <div className="skeleton" style={{ width: 40, height: 32, marginBottom: 6 }} />
                <div className="skeleton" style={{ width: 50, height: 20, borderRadius: 999 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
