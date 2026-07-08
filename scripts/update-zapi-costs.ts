import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";
import { inArray } from "drizzle-orm";

async function main() {
  console.log("Updating Z-API costs...");
  
  // R$ 99,99 para Ximendes e Maycon
  const orgs99 = ["Ximendes Odontologia", "Maycon bordados", "Maycon Bordados"];
  await db.update(organizations)
    .set({ zapiMonthlyCostBrl: 9999 })
    .where(inArray(organizations.name, orgs99));
    
  // R$ 79,99 para NC Beauty e Vitalli
  const orgs79 = ["NC Beauty & clinic", "NC Beauty & Clinic", "Clínica Vitalli", "Clinica Vitalli"];
  await db.update(organizations)
    .set({ zapiMonthlyCostBrl: 7999 })
    .where(inArray(organizations.name, orgs79));

  console.log("Z-API costs updated.");
  process.exit(0);
}

main().catch(console.error);
