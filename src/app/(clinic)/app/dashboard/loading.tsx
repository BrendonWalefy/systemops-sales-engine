export default function DashboardLoading() {
  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="dashboard-title">
          <div className="skeleton" style={{ width: 118, height: 12, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 170, height: 36, marginBottom: 10 }} />
          <div className="skeleton" style={{ width: 230, height: 14 }} />
        </div>

        <div className="dashboard-topbar-actions">
          <div className="skeleton" style={{ width: 154, height: 31, borderRadius: 999 }} />
          <div className="skeleton" style={{ width: 122, height: 31, borderRadius: 999 }} />
        </div>
      </header>

      <section className="dashboard-kpis" aria-label="Carregando indicadores">
        {Array.from({ length: 4 }).map((_, index) => (
          <article key={index} className={`dashboard-kpi-card${index === 1 ? " featured" : ""}`}>
            <div className="dashboard-kpi-header">
              <div className="skeleton" style={{ width: 24, height: 24, borderRadius: 7 }} />
              <div className="skeleton" style={{ width: 112, height: 13 }} />
              <div className="skeleton" style={{ width: 46, height: 20, borderRadius: 999, marginLeft: "auto" }} />
            </div>
            <div className="skeleton" style={{ width: 66, height: 38, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: 134, height: 12 }} />
          </article>
        ))}
      </section>

      <main className="dashboard-grid">
        <section className="dashboard-panel dashboard-flow-panel">
          <div className="dashboard-panel-header">
            <div>
              <div className="skeleton" style={{ width: 92, height: 11, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: 160, height: 18 }} />
            </div>
            <div className="skeleton" style={{ width: 72, height: 26, borderRadius: 999 }} />
          </div>
          <div className="dashboard-chart-wrap">
            <div className="skeleton" style={{ width: "100%", minHeight: 300, borderRadius: 8 }} />
            <div className="dashboard-chart-labels">
              {Array.from({ length: 7 }).map((_, index) => (
                <span key={index}>
                  <div className="skeleton" style={{ width: "60%", height: 12, margin: "0 auto" }} />
                  <div className="skeleton" style={{ width: "76%", height: 10, margin: "0 auto" }} />
                </span>
              ))}
            </div>
          </div>
          <div className="dashboard-insights">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index}>
                <div className="skeleton" style={{ width: 15, height: 15, borderRadius: 4 }} />
                <span>
                  <div className="skeleton" style={{ width: 58, height: 13 }} />
                  <div className="skeleton" style={{ width: 96, height: 11 }} />
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-panel dashboard-leads-panel">
          <div className="dashboard-panel-header compact">
            <div>
              <div className="skeleton" style={{ width: 106, height: 11, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: 130, height: 18 }} />
            </div>
            <div className="skeleton" style={{ width: 38, height: 26, borderRadius: 999 }} />
          </div>
          <div style={{ padding: 14, display: "grid", gap: 12 }}>
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div className="skeleton" style={{ width: 30, height: 30, borderRadius: 8, flex: "0 0 auto" }} />
                <div style={{ flex: 1, display: "grid", gap: 5, minWidth: 0 }}>
                  <div className="skeleton" style={{ width: "58%", height: 12 }} />
                  <div className="skeleton" style={{ width: "44%", height: 11 }} />
                </div>
                <div className="skeleton" style={{ width: 70, height: 22, borderRadius: 999 }} />
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-panel dashboard-temp-panel">
          <div className="dashboard-panel-header compact">
            <div>
              <div className="skeleton" style={{ width: 98, height: 11, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: 216, height: 18 }} />
            </div>
            <div className="skeleton" style={{ width: 48, height: 26, borderRadius: 999 }} />
          </div>
          <div className="dashboard-temp-content">
            <div className="skeleton" style={{ width: 132, aspectRatio: "1", borderRadius: 999 }} />
            <div className="dashboard-temp-list">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="dashboard-temp-row">
                  <div className="skeleton" style={{ width: 90, height: 13 }} />
                  <div className="skeleton" style={{ width: 42, height: 13 }} />
                  <div className="skeleton" style={{ width: 30, height: 20, borderRadius: 999 }} />
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
