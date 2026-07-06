// Renomeia uma clínica (name + slug) com segurança.
// Uso: npx tsx scripts/rename-clinic.ts <clinicId> "Novo Nome" [novo-slug]
// Sem slug, deriva do nome (minúsculas, sem acento, hífens).

import { config } from "dotenv";
config({ path: ".env.local" });

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  const [clinicId, newName, slugArg] = process.argv.slice(2);
  if (!clinicId || !newName) {
    console.error('Uso: npx tsx scripts/rename-clinic.ts <clinicId> "Novo Nome" [novo-slug]');
    process.exit(1);
  }

  const { db } = await import("../src/infrastructure/db/client");
  const { organizations } = await import("../src/infrastructure/db/schema");
  const { eq } = await import("drizzle-orm");

  const current = await db.query.organizations.findFirst({
    where: eq(organizations.id, clinicId),
    columns: { id: true, name: true, slug: true },
  });
  if (!current) {
    console.error(`Clínica não encontrada: ${clinicId}`);
    process.exit(1);
  }

  const newSlug = slugArg ?? slugify(newName);
  const [updated] = await db
    .update(organizations)
    .set({ name: newName, slug: newSlug, updatedAt: new Date() })
    .where(eq(organizations.id, clinicId))
    .returning({ id: organizations.id, name: organizations.name, slug: organizations.slug });

  console.log(`Antes:  ${current.name} (${current.slug})`);
  console.log(`Depois: ${updated.name} (${updated.slug})`);
  console.log(
    "Obs.: mensagens já registradas em conversas não são reescritas — a IA usa o nome novo daqui em diante.",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
