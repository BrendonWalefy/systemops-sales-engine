/**
 * Script de migração: encripta credenciais de canal que ainda estão em plaintext.
 *
 * Deve ser rodado UMA VEZ após adicionar CREDENTIAL_ENCRYPTION_KEY ao ambiente.
 * É idempotente: valores que já começam com "enc:v1:" são ignorados.
 *
 * Uso:
 *   npx dotenv -e .env.local -- npx tsx scripts/encrypt-existing-credentials.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { isNotNull, or, eq } from "drizzle-orm";
import * as schema from "../src/infrastructure/db/schema";
import {
  encryptCredential,
  decryptCredential,
} from "../src/infrastructure/crypto/credential-vault";

const { clinics } = schema;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não definida");

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  const rows = await db
    .select({
      id: clinics.id,
      name: clinics.name,
      zapiToken: clinics.zapiToken,
      zapiClientToken: clinics.zapiClientToken,
      metaAccessToken: clinics.metaAccessToken,
    })
    .from(clinics)
    .where(
      or(
        isNotNull(clinics.zapiToken),
        isNotNull(clinics.zapiClientToken),
        isNotNull(clinics.metaAccessToken),
      ),
    );

  console.log(`Clínicas com credenciais: ${rows.length}`);

  for (const row of rows) {
    const updates: Partial<typeof schema.clinics.$inferInsert> = {};

    if (row.zapiToken && !row.zapiToken.startsWith("enc:v1:")) {
      updates.zapiToken = encryptCredential(row.zapiToken);
    }
    if (row.zapiClientToken && !row.zapiClientToken.startsWith("enc:v1:")) {
      updates.zapiClientToken = encryptCredential(row.zapiClientToken);
    }
    if (row.metaAccessToken && !row.metaAccessToken.startsWith("enc:v1:")) {
      updates.metaAccessToken = encryptCredential(row.metaAccessToken);
    }

    if (Object.keys(updates).length === 0) {
      console.log(`  [skip] ${row.name} — já encriptada`);
      continue;
    }

    await db
      .update(clinics)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(clinics.id, row.id));

    const fields = Object.keys(updates).join(", ");
    console.log(`  [ok]   ${row.name} — encriptado: ${fields}`);
  }

  // Verificação final: tenta decriptar para confirmar que a chave bate
  const verify = await db
    .select({ id: clinics.id, name: clinics.name, zapiToken: clinics.zapiToken })
    .from(clinics)
    .where(isNotNull(clinics.zapiToken));

  let verifyErrors = 0;
  for (const row of verify) {
    if (!row.zapiToken) continue;
    try {
      decryptCredential(row.zapiToken);
    } catch {
      console.error(`  [erro] ${row.name} — falha ao decriptar zapiToken`);
      verifyErrors++;
    }
  }

  if (verifyErrors > 0) {
    console.error(`\nMigração concluída com ${verifyErrors} erro(s) de verificação.`);
    process.exit(1);
  }

  console.log("\nMigração concluída com sucesso.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
