/**
 * Define o nome de exibição (display_name) de um membro de clínica — usado na
 * saudação do dashboard ("Olá, {nome}!"). Funciona para qualquer clínica.
 *
 * É idempotente: rodar de novo com o mesmo valor não muda nada.
 *
 * Uso:
 *   npx tsx scripts/set-member-display-name.ts \
 *     --clinic ximendes --email "login@dominio.com" --name "Dr. Gregorie"
 *
 *   # --clinic aceita o slug ("ximendes") ou o nome ("Ximendes Odontologia").
 *   # Para limpar o nome e voltar ao fallback, passe --name "".
 *
 * Requer DATABASE_URL no ambiente (ou .env.local).
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, or } from "drizzle-orm";
import { organizations, clinicMembers } from "../src/infrastructure/db/schema";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = "";
      }
    }
  }
  return out;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL não está definido.");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const clinicRef = args.clinic?.trim();
  const email = args.email?.trim().toLowerCase();
  const displayName = (args.name ?? "").trim();

  if (!clinicRef || !email || args.name === undefined) {
    console.error(
      "Uso: --clinic <slug-ou-nome> --email <email> --name <nome de exibição>",
    );
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  try {
    const clinic = await db
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
      .from(organizations)
      .where(or(eq(organizations.slug, clinicRef), eq(organizations.name, clinicRef)))
      .limit(1);

    if (clinic.length === 0) {
      console.error(`Clínica não encontrada para "${clinicRef}".`);
      process.exit(1);
    }

    const clinicId = clinic[0].id;

    const member = await db
      .select({ id: clinicMembers.id, displayName: clinicMembers.displayName })
      .from(clinicMembers)
      .where(and(eq(clinicMembers.clinicId, clinicId), eq(clinicMembers.email, email)))
      .limit(1);

    if (member.length === 0) {
      console.error(
        `Nenhum membro com e-mail "${email}" na clínica "${clinic[0].name}".`,
      );
      process.exit(1);
    }

    const nextValue = displayName.length > 0 ? displayName : null;

    if ((member[0].displayName ?? null) === nextValue) {
      console.log(`✔︎ Nada a fazer — display_name já é "${nextValue ?? "(vazio)"}".`);
      return;
    }

    await db
      .update(clinicMembers)
      .set({ displayName: nextValue })
      .where(eq(clinicMembers.id, member[0].id));

    console.log("✅ display_name atualizado:");
    console.log(`   Clínica: ${clinic[0].name} (${clinic[0].slug ?? "sem slug"})`);
    console.log(`   E-mail:  ${email}`);
    console.log(`   Nome:    ${nextValue ?? "(vazio → fallback)"}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
