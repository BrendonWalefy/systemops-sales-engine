import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

const rows = await sql`
  SELECT c.id, c.ai_paused, c.takeover_expires_at, c.needs_attention,
         l.phone, c.last_message_at
  FROM conversations c
  JOIN leads l ON c.lead_id = l.id
  WHERE c.clinic_id = '5a2ce07d-cfa1-4108-9a3c-3d1fae017067'
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT 5
`;

for (const r of rows) {
  const paused = r.ai_paused ? `🔴 PAUSADA até ${r.takeover_expires_at ?? "indefinido"}` : "🟢 ativa";
  const last = r.last_message_at ? new Date(r.last_message_at).toLocaleTimeString("pt-BR") : "—";
  console.log(`${r.phone} | ${paused} | última msg: ${last}`);
}

await sql.end();
