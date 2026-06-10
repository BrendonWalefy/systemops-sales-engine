import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { messages, conversations, leads } from "../src/infrastructure/db/schema";
import { eq, and, desc } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL!;
const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

// Últimas 10 mensagens de qualquer conversa
const rows = await db
  .select({
    phone: leads.phone,
    author: messages.author,
    content: messages.body,
    sentAt: messages.sentAt,
    conversationId: messages.conversationId,
  })
  .from(messages)
  .innerJoin(conversations, eq(messages.conversationId, conversations.id))
  .innerJoin(leads, eq(conversations.leadId, leads.id))
  .orderBy(desc(messages.sentAt))
  .limit(15);

for (const r of rows) {
  const time = new Date(r.sentAt!).toLocaleTimeString("pt-BR");
  const content = (r.content ?? "").slice(0, 80);
  console.log(`[${time}] ${r.author.padEnd(10)} | ${r.phone} | ${content}`);
}

await sql.end();
