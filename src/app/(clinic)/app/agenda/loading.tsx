export default function AgendaLoading() {
  return (
    <div style={{ padding: "24px 24px 32px" }}>
      <div style={{ display: "grid", gap: "14px" }}>
        <div className="skeleton" style={{ width: 92, height: 12 }} />
        <div className="skeleton" style={{ width: 220, height: 34 }} />
        <div className="skeleton" style={{ width: "100%", height: 42, borderRadius: 12 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 14 }}>
          <div className="skeleton" style={{ width: "100%", minHeight: 640, borderRadius: 18 }} />
          <div className="skeleton" style={{ width: "100%", minHeight: 640, borderRadius: 18 }} />
        </div>
      </div>
    </div>
  );
}
