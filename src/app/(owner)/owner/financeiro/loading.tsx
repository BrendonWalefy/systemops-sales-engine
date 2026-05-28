export default function Loading() {
  return (
    <div>
      <div className="product-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="skeleton" style={{ width: 90, height: 13, borderRadius: 4 }} />
          <div className="skeleton" style={{ width: 100, height: 26, borderRadius: 6 }} />
        </div>
      </div>

      <div className="page-content" style={{ paddingBottom: 60, display: "grid", gap: 32 }}>
        <div className="kpi-strip" style={{ padding: 0 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="metric">
              <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
                <div className="skeleton" style={{ width: 12, height: 12, borderRadius: 3 }} />
                <div className="skeleton" style={{ flex: 1, height: 10, borderRadius: 4 }} />
              </div>
              <div className="skeleton" style={{ width: "60%", height: 24, marginBottom: 6, borderRadius: 4 }} />
              <div className="skeleton" style={{ width: "50%", height: 10, borderRadius: 4 }} />
            </div>
          ))}
        </div>

        <div className="skeleton" style={{ height: 220, borderRadius: 12 }} />
        <div className="skeleton" style={{ height: 160, borderRadius: 12 }} />
      </div>
    </div>
  );
}
