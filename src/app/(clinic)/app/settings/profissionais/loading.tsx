export default function ProfissionaisLoading() {
  return (
    <div style={{ padding: "28px 20px" }}>
      <div style={{ display: "grid", gap: 18 }}>
        <div className="skeleton" style={{ width: 116, height: 12 }} />
        <div className="skeleton" style={{ width: 240, height: 40 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <div className="skeleton" style={{ width: "100%", minHeight: 96, borderRadius: 14 }} />
          <div className="skeleton" style={{ width: "100%", minHeight: 96, borderRadius: 14 }} />
          <div className="skeleton" style={{ width: "100%", minHeight: 96, borderRadius: 14 }} />
        </div>
        <div className="skeleton" style={{ width: "100%", minHeight: 360, borderRadius: 14 }} />
      </div>
    </div>
  );
}
