/**
 * Remove leads/conversations E2E que vazaram para o banco de produção.
 * Uso: npx tsx scripts/delete-e2e-leads.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { inArray, like } from "drizzle-orm";
import {
  leads,
  conversations,
  messages,
  conversationStates,
  appointments,
  slotReservations,
  followUps,
} from "../src/infrastructure/db/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const client = postgres(connectionString);
const db = drizzle(client);

const e2eLeads = await db
  .select({ id: leads.id, phone: leads.phone, name: leads.name })
  .from(leads)
  .where(like(leads.phone, "e2e-%"));

if (e2eLeads.length === 0) {
  console.log("Nenhum lead E2E encontrado.");
  await client.end();
  process.exit(0);
}

console.log(`Encontrado(s) ${e2eLeads.length} lead(s) E2E:`);
for (const l of e2eLeads) {
  console.log(`  - ${l.name ?? "(sem nome)"} | phone: ${l.phone} | id: ${l.id}`);
}

const leadIds = e2eLeads.map((l) => l.id);

const convRows = await db
  .select({ id: conversations.id })
  .from(conversations)
  .where(inArray(conversations.leadId, leadIds));

const convIds = convRows.map((c) => c.id);

if (convIds.length > 0) {
  await db.delete(messages).where(inArray(messages.conversationId, convIds));
  await db.delete(conversationStates).where(inArray(conversationStates.conversationId, convIds));
}

await db.delete(slotReservations).where(inArray(slotReservations.leadId, leadIds));
await db.delete(appointments).where(inArray(appointments.leadId, leadIds));
await db.delete(followUps).where(inArray(followUps.leadId, leadIds));
await db.delete(conversations).where(inArray(conversations.leadId, leadIds));
await db.delete(leads).where(inArray(leads.id, leadIds));

console.log("Leads E2E removidos com sucesso ✓");
await client.end();
