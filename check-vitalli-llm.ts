import { db } from "./src/infrastructure/db/client";
import { organizations } from "./src/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { buildCorpus } from "./src/application/setup-study/build-corpus";
import { extractFindings } from "./src/application/setup-study/extract-findings";

async function main() {
  const clinics = await db.select().from(organizations).where(eq(organizations.name, "Clínica Vitalli"));
  const clinic = clinics[0];

  const corpus = await buildCorpus(clinic.id);
  console.log("Corpus size:", corpus.text.length);
  
  const findings = await extractFindings(corpus);
  console.log("Findings extracted:", findings.length);
  console.log(JSON.stringify(findings, null, 2));

  process.exit(0);
}

main().catch(console.error);
