// Marca/desmarca uma clínica como DEMO (vitrine com dados fictícios).
// Clínicas demo rodam o mecanismo real do sistema, mas são excluídas dos
// alertas operacionais e do digest de saúde por email — dados fictícios não
// geram incidentes reais.
//
// Uso:
//   npx tsx scripts/set-demo-clinic.ts "<clinicId|nome>"        # marca como demo
//   npx tsx scripts/set-demo-clinic.ts "<clinicId|nome>" off    # remove a flag
//
// O identificador pode ser o UUID da clínica ou o nome exato (ex.: "Odonto Marques").

import { config } from "dotenv";
config({ path: ".env.local" });

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const [identifier, flagArg] = process.argv.slice(2);
  if (!identifier) {
    console.error(
      'Uso: npx tsx scripts/set-demo-clinic.ts "<clinicId|nome>" [off]',
    );
    process.exit(1);
  }

  const nextIsDemo = flagArg !== "off" && flagArg !== "false";

  const { db } = await import("../src/infrastructure/db/client");
  const { organizations } = await import("../src/infrastructure/db/schema");
  const { eq } = await import("drizzle-orm");

  const current = await db.query.organizations.findFirst({
    where: UUID_RE.test(identifier)
      ? eq(organizations.id, identifier)
      : eq(organizations.name, identifier),
    columns: { id: true, name: true, isDemo: true },
  });

  if (!current) {
    console.error(`Clínica não encontrada: ${identifier}`);
    process.exit(1);
  }

  if (current.isDemo === nextIsDemo) {
    console.log(
      `Nada a fazer — "${current.name}" já está ${nextIsDemo ? "marcada como demo" : "sem a flag demo"}.`,
    );
    process.exit(0);
  }

  await db
    .update(organizations)
    .set({ isDemo: nextIsDemo, updatedAt: new Date() })
    .where(eq(organizations.id, current.id));

  console.log(
    `"${current.name}" (${current.id}) agora ${nextIsDemo ? "É uma clínica DEMO" : "NÃO é mais demo"}.`,
  );
  console.log(
    nextIsDemo
      ? "Alertas operacionais e o digest de saúde por email deixam de considerá-la."
      : "Volta a ser monitorada nos alertas operacionais e no digest por email.",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
