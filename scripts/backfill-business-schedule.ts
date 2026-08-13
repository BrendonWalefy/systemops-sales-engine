// Backfill de organizations.business_schedule a partir do texto legado
// business_hours. Idempotente: só escreve onde business_schedule é nulo.
//
// Preserva o comportamento atual EXATAMENTE, inclusive as limitações — não
// adivinha o que o texto não diz. Uma clínica cujo texto dizia "Segunda a sexta,
// das 8h às 18h" resulta em cinco dias com uma janela cada, nem mais nem menos.
//
// Uso:
//   npm run db:backfill-schedule -- --dry-run
//   npm run db:backfill-schedule
//
// Ver docs/superpowers/specs/2026-08-13-per-day-business-hours-design.md
import { isNull, and, isNotNull, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";
import { parseBusinessHours } from "@/core/scheduling/ClinicTimezone";
import {
  scheduleFromParsedBusinessHours,
  operatingWeekdays,
  windowsForWeekday,
  type BusinessSchedule,
} from "@/core/scheduling/BusinessSchedule";

const WEEKDAY_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function describe(schedule: BusinessSchedule): string {
  return operatingWeekdays(schedule)
    .map((weekday) => {
      const windows = windowsForWeekday(schedule, weekday)
        .map((w) => `${w.startHour}:${String(w.startMinute).padStart(2, "0")}-${w.endHour}:${String(w.endMinute).padStart(2, "0")}`)
        .join(" e ");
      return `${WEEKDAY_LABEL[weekday]} ${windows}`;
    })
    .join(" | ");
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const pending = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      businessHours: organizations.businessHours,
    })
    .from(organizations)
    .where(and(isNull(organizations.businessSchedule), isNotNull(organizations.businessHours)));

  if (pending.length === 0) {
    process.stdout.write("nada a preencher: nenhuma organização com texto legado e escala nula\n");
    return;
  }

  process.stdout.write(`${pending.length} organização(ões) a preencher${dryRun ? " (dry-run)" : ""}\n\n`);

  let written = 0;
  let skipped = 0;

  for (const org of pending) {
    const parsed = parseBusinessHours(org.businessHours);
    const schedule = scheduleFromParsedBusinessHours(parsed);

    // Texto que não rende dia algum não vira escala: a leitura cai no fallback
    // legado, que é mais honesto que gravar uma escala inventada.
    if (operatingWeekdays(schedule).length === 0) {
      process.stdout.write(`  PULADA  ${org.name}\n    texto: ${JSON.stringify(org.businessHours)}\n    motivo: parser não encontrou nenhum dia de operação\n`);
      skipped += 1;
      continue;
    }

    process.stdout.write(`  ${dryRun ? "SERIA" : "GRAVADA"}  ${org.name}\n    texto: ${JSON.stringify(org.businessHours)}\n    escala: ${describe(schedule)}\n`);

    if (!dryRun) {
      await db
        .update(organizations)
        .set({ businessSchedule: schedule })
        .where(eq(organizations.id, org.id));
    }
    written += 1;
  }

  process.stdout.write(`\n${dryRun ? "seriam gravadas" : "gravadas"}: ${written} | puladas: ${skipped}\n`);
  if (dryRun) {
    process.stdout.write("dry-run: nada foi escrito. Confira a coluna 'escala' contra o 'texto' antes de rodar sem a flag.\n");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
