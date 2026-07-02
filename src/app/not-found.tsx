import Link from "next/link";

// Página 404 branded — substitui o 404 genérico do Next.
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <p style={{ fontSize: 40, fontWeight: 800, margin: "0 0 4px", color: "#7c5cff" }}>404</p>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px", color: "#fafafa" }}>
          Página não encontrada
        </h1>
        <p style={{ color: "#a1a1aa", margin: "0 0 20px", lineHeight: 1.5 }}>
          O endereço que você tentou acessar não existe ou foi movido.
        </p>
        <Link
          href="/"
          style={{
            display: "inline-block",
            padding: "10px 20px",
            borderRadius: 8,
            background: "#7c5cff",
            color: "#fff",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
