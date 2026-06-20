export default function PipelineLoading() {
  return (
    <div style={{ padding: "28px 20px" }}>
      <div style={{ display: "grid", gap: 16 }}>
        <div className="skeleton" style={{ width: 220, height: 38 }} />
        <div className="skeleton" style={{ width: 360, height: 14 }} />
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="skeleton" style={{ width: "100%", height: 72, borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );
}
