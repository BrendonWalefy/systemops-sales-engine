export default function ConversationLoading() {
  return (
    <div className="conv-root" style={{ background: "var(--background)" }}>
      <div className="conv-header-v2">
        <div className="skeleton" style={{ width: 32, height: 32, borderRadius: "50%" }} />
        <div className="skeleton" style={{ width: 40, height: 40, borderRadius: "50%" }} />
        <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
          <div className="skeleton" style={{ width: "38%", height: 14 }} />
          <div className="skeleton" style={{ width: "24%", height: 10 }} />
        </div>
        <div className="skeleton" style={{ width: 32, height: 32, borderRadius: "50%" }} />
      </div>

      <div className="conv-body">
        <div className="conv-message-col">
          <div className="conv-messages">
            <div className="chat-window" style={{ flex: 1, maxHeight: "none", minHeight: 0 }}>
              {Array.from({ length: 7 }).map((_, index) => {
                const isRight = index % 2 === 1;
                return (
                  <div
                    key={index}
                    style={{
                      width: isRight ? "72%" : "78%",
                      alignSelf: isRight ? "flex-end" : "flex-start",
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div className="skeleton" style={{ width: 74, height: 10, borderRadius: 999 }} />
                    <div className="skeleton" style={{ width: "100%", height: isRight ? 84 : 72, borderRadius: 18 }} />
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding: "12px 16px 18px", borderTop: "1px solid var(--line)", display: "grid", gap: 10 }}>
            <div className="skeleton" style={{ width: "100%", height: 46, borderRadius: 14 }} />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div className="skeleton" style={{ width: 96, height: 36, borderRadius: 12 }} />
            </div>
          </div>
        </div>

        <div className="conv-lead-panel">
          <div className="skeleton" style={{ width: "100%", height: 120, borderRadius: 18 }} />
          <div className="skeleton" style={{ width: "100%", height: 168, borderRadius: 18 }} />
        </div>
      </div>
    </div>
  );
}
