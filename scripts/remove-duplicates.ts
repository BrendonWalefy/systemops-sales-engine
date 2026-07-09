import { db } from "../src/infrastructure/db/client";
import { appointments } from "../src/infrastructure/db/schema";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Buscando duplicatas de agendamentos...");

  // Get all appointments grouped by calendarEventId having more than 1
  const duplicates = await db.execute<{ calendar_event_id: string; count: number }>(sql`
    SELECT calendar_event_id, count(*) 
    FROM appointments 
    WHERE calendar_event_id IS NOT NULL 
    GROUP BY calendar_event_id 
    HAVING count(*) > 1
  `);

  console.log(`Encontrados ${duplicates.rows.length} eventos duplicados.`);

  let deletedCount = 0;

  for (const row of duplicates.rows) {
    const eventId = row.calendar_event_id;

    // Get all appointments for this eventId ordered by createdAt desc (keep the newest, or keep the oldest?)
    // Let's keep the OLDEST one and delete the rest, since the oldest one might have been confirmed/edited manually.
    // Wait, the newest one is the one we just imported with the description, BUT we already made the importer UPSERT the description.
    // So the oldest one is safe to keep.
    const records = await db.query.appointments.findMany({
      where: (appts, { eq }) => eq(appts.calendarEventId, eventId),
      orderBy: (appts, { asc }) => [asc(appts.createdAt)]
    });

    // Keep the first, delete the rest
    const toDelete = records.slice(1);
    
    for (const record of toDelete) {
      await db.delete(appointments).where(sql`id = ${record.id}`);
      deletedCount++;
    }
  }

  console.log(`Deletados ${deletedCount} agendamentos duplicados com sucesso.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
