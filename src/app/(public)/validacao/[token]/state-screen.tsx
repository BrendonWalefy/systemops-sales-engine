/** Tela de estado da página pública (expirado / concluído / inválido). */
export function StateScreen({
  emoji,
  title,
  message,
}: {
  emoji: string;
  title: string;
  message: string;
}) {
  return (
    <div
      style={{
        maxWidth: 440,
        width: "100%",
        margin: "auto",
        textAlign: "center",
        display: "grid",
        gap: 12,
        padding: "40px 20px",
      }}
    >
      <div style={{ fontSize: 48, lineHeight: 1 }}>{emoji}</div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{title}</h1>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "#a1a1aa" }}>
        {message}
      </p>
    </div>
  );
}
