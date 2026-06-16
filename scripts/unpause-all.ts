import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { conversations } from "../src/infrastructure/db/schema";
import { eq, and } from "drizzle-orm";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql);

const CLINIC_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";

// Despausa todas as conversas pausadas da clínica
const rows = await db
  .update(conversations)
  .set({ aiPaused: false, takeoverExpiresAt: null, needsAttention: false, updatedAt: new Date() })
  .where(and(eq(conversations.clinicId, CLINIC_ID), eq(conversations.aiPaused, true)))
  .returning({ id: conversations.id });

console.log(`✅ ${rows.length} conversa(s) despausada(s)`);
await sql.end();
