export default function Loading() {
  return (
    <div>
      <div className="product-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div className="skeleton" style={{ width: 90, height: 13, borderRadius: 4 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="skeleton" style={{ width: 180, height: 26, borderRadius: 6 }} />
            <div className="skeleton" style={{ width: 120, height: 11, borderRadius: 4 }} />
          </div>
        </div>
      </div>

      <div className="page-content" style={{ paddingBottom: 60, display: "grid", gap: 32 }}>
        <div className="kpi-strip" style={{ padding: 0 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="metric">
              <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
                <div className="skeleton" style={{ flex: 1, height: 10, borderRadius: 4 }} />
              </div>
              <div className="skeleton" style={{ width: "50%", height: 22, marginBottom: 6, borderRadius: 4 }} />
              <div className="skeleton" style={{ width: "40%", height: 10, borderRadius: 4 }} />
            </div>
          ))}
        </div>

        <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />

        <div>
          <div className="skeleton" style={{ width: 160, height: 10, marginBottom: 12, borderRadius: 4 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="metric">
                <div className="skeleton" style={{ width: "70%", height: 10, marginBottom: 10, borderRadius: 4 }} />
                <div className="skeleton" style={{ width: "40%", height: 22, marginBottom: 6, borderRadius: 4 }} />
                <div className="skeleton" style={{ width: "50%", height: 18, borderRadius: 9 }} />
              </div>
            ))}
          </div>
        </div>

        <div className="skeleton" style={{ height: 120, borderRadius: 12 }} />
      </div>
    </div>
  );
}
