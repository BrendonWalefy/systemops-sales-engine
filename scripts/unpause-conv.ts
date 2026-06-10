import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { conversations } from "../src/infrastructure/db/schema";
import { eq } from "drizzle-orm";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql);

const CONV_ID = "76d2293e-6fef-4cc9-89b6-8973da70aab0";

await db.update(conversations).set({
  aiPaused: false,
  takeoverExpiresAt: null,
  needsAttention: false,
  updatedAt: new Date(),
}).where(eq(conversations.id, CONV_ID));

console.log("✅ IA reativada na conversa", CONV_ID);
await sql.end();
