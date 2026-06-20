export default function EquipeLoading() {
  return (
    <div style={{ maxWidth: 720, padding: "28px 20px" }}>
      <div style={{ display: "grid", gap: 18 }}>
        <div className="skeleton" style={{ width: 104, height: 12 }} />
        <div className="skeleton" style={{ width: 180, height: 40 }} />
        <div className="skeleton" style={{ width: "100%", minHeight: 236, borderRadius: 14 }} />
        <div className="skeleton" style={{ width: "100%", minHeight: 320, borderRadius: 14 }} />
      </div>
    </div>
  );
}
