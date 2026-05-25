export default function InboxLoading() {
  return (
    <div>
      <div className="product-topbar">
        <div>
          <div className="skeleton" style={{ width: 80, height: 28, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 140, height: 16 }} />
        </div>
      </div>

      <div style={{ padding: "0 28px 28px", display: "flex", flexDirection: "column", gap: 2 }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="conversation-card" style={{ pointerEvents: "none" }}>
            <div className="conversation-row">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div className="skeleton" style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="skeleton" style={{ width: 120, height: 14 }} />
                  <div className="skeleton" style={{ width: 90, height: 12 }} />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <div className="skeleton" style={{ width: 48, height: 20, borderRadius: 999 }} />
                <div className="skeleton" style={{ width: 36, height: 12 }} />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
              <div className="skeleton" style={{ height: 13, flex: 1 }} />
              <div className="skeleton" style={{ width: 72, height: 22, borderRadius: 999 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
