import { db } from "./src/infrastructure/db/client";
import { conversations, messages, organizations } from "./src/infrastructure/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { buildCorpus } from "./src/application/setup-study/build-corpus";

async function main() {
  const clinics = await db.select().from(organizations).where(eq(organizations.name, "Clínica Vitalli"));
  const clinic = clinics[0];
  console.log("Clinic Paired At:", clinic.channelPairedAt);

  const corpus = await buildCorpus(clinic.id);
  console.log("Corpus Period:", corpus.periodStart, "to", corpus.periodEnd);
  console.log("Conversations:", corpus.conversationCount);
  console.log("Total Messages:", corpus.totalMessages);
  console.log("Corpus Length:", corpus.text.length);
  
  process.exit(0);
}

main().catch(console.error);
