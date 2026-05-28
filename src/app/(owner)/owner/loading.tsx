export default function Loading() {
  return (
    <div>
      <div className="product-topbar">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="skeleton" style={{ width: 72, height: 10, borderRadius: 4 }} />
          <div className="skeleton" style={{ width: 220, height: 26, borderRadius: 6 }} />
          <div className="skeleton" style={{ width: 130, height: 11, borderRadius: 4 }} />
        </div>
      </div>

      <div className="kpi-strip">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="metric">
            <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
              <div className="skeleton" style={{ width: 12, height: 12, borderRadius: 3 }} />
              <div className="skeleton" style={{ flex: 1, height: 10, borderRadius: 4 }} />
            </div>
            <div className="skeleton" style={{ width: "55%", height: 22, marginBottom: 6, borderRadius: 4 }} />
            <div className="skeleton" style={{ width: "45%", height: 10, borderRadius: 4 }} />
          </div>
        ))}
      </div>

      <div className="page-content" style={{ paddingBottom: 60 }}>
        <div className="skeleton" style={{ height: 180, borderRadius: 12 }} />
      </div>
    </div>
  );
}
