import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { messages, conversations, leads } from "../src/infrastructure/db/schema";
import { eq, and, gte, count, desc } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const oneHourAgo = new Date(Date.now() - 60 * 60_000);

const rows = await db
  .select({ phone: leads.phone, total: count() })
  .from(messages)
  .innerJoin(conversations, eq(messages.conversationId, conversations.id))
  .innerJoin(leads, eq(conversations.leadId, leads.id))
  .where(
    and(
      eq(messages.author, "lead"),
      gte(messages.sentAt, oneHourAgo)
    )
  )
  .groupBy(leads.phone)
  .orderBy(desc(count()));

if (rows.length === 0) {
  console.log("✅ Nenhuma mensagem na última hora.");
} else {
  console.log("📊 Mensagens na última hora por lead:");
  for (const r of rows) {
    const n = Number(r.total);
    const status = n >= 30 ? "🔴 LIMITADO (≥30)" : n >= 20 ? "🟡 Próximo do limite" : "🟢 OK";
    console.log(`  ${r.phone}: ${n} msgs — ${status}`);
  }
}

await sql.end();
