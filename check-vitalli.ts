import { db } from "./src/infrastructure/db/client";
import { conversations, messages, organizations } from "./src/infrastructure/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const clinics = await db.select().from(organizations).where(eq(organizations.name, "Clínica Vitalli"));
  if (clinics.length === 0) {
    console.log("Vitalli not found");
    process.exit(0);
  }
  const clinic = clinics[0];
  console.log("Clinic ID:", clinic.id);

  const msgs = await db.select({
    author: messages.author,
  }).from(messages)
  .innerJoin(conversations, eq(messages.conversationId, conversations.id))
  .where(eq(conversations.clinicId, clinic.id));

  const counts: Record<string, number> = {};
  for (const m of msgs) {
    counts[m.author] = (counts[m.author] || 0) + 1;
  }
  console.log("Message counts by author:", counts);
  
  process.exit(0);
}

main().catch(console.error);
