import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

const rows = await sql`
  SELECT m.author, m.body, m.sent_at, m.intent, m.delivery_format
  FROM messages m
  JOIN conversations c ON m.conversation_id = c.id
  JOIN leads l ON c.lead_id = l.id
  WHERE l.phone LIKE '%53628848%'
    AND m.sent_at >= NOW() - INTERVAL '24 hours'
  ORDER BY m.sent_at ASC
`;

for (const r of rows) {
  const t = new Date(r.sent_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const body = (r.body ?? "").slice(0, 120);
  console.log(`[${t}] ${r.author.padEnd(12)} | ${(r.intent ?? "").padEnd(20)} | ${body}`);
}
console.log("\nTotal:", rows.length, "mensagens");
console.log("Agent msgs:", rows.filter((r: { author: string }) => r.author === "agent").length);
console.log("Lead msgs:", rows.filter((r: { author: string }) => r.author === "lead").length);

await sql.end();
