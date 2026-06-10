import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { clinics } from "../src/infrastructure/db/schema";
import { eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL!;
const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const XIMENDES_CLINIC_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";

const before = await db
  .select({ ttsConfig: clinics.ttsConfig, ttsVoice: clinics.ttsVoice })
  .from(clinics)
  .where(eq(clinics.id, XIMENDES_CLINIC_ID));

console.log("Antes:", JSON.stringify(before[0]));

await db
  .update(clinics)
  .set({ ttsConfig: { provider: "neural2", speed: 1.0 } })
  .where(eq(clinics.id, XIMENDES_CLINIC_ID));

const after = await db
  .select({ ttsConfig: clinics.ttsConfig })
  .from(clinics)
  .where(eq(clinics.id, XIMENDES_CLINIC_ID));

console.log("Depois:", JSON.stringify(after[0]));
console.log("✅ ttsConfig atualizado para neural2");

await sql.end();
