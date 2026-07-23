import { db } from "../src/infrastructure/db/client";
import { treatments } from "../src/infrastructure/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  // Vitalli
  const vitalliId = "d24a584a-faac-4a46-9750-a718d0f8e686";
  const vitalliTreatments = await db.select().from(treatments).where(eq(treatments.clinicId, vitalliId));
  
  console.log("========== CLÍNICA VITALLI ==========\n");
  for (const t of vitalliTreatments) {
    console.log(`\n--- Treatment: ${t.name} ---`);
    console.log(`  ID: ${t.id}`);
    console.log(`  Duration: ${t.durationMinutes}min`);
    console.log(`  Requires Evaluation: ${t.requiresEvaluationFirst}`);
    console.log(`  Price Quotable: ${t.priceQuotableInChat}`);
    console.log(`  Price: ${t.priceCents ? `R$ ${(t.priceCents/100).toFixed(2)}` : "null"}`);
    console.log(`  Min Price: ${t.minPriceCents ? `R$ ${(t.minPriceCents/100).toFixed(2)}` : "null"}`);
    console.log(`  Price Kind: ${t.priceKind}`);
    console.log(`  Aliases: ${JSON.stringify(t.aliases)}`);
    console.log(`  Is Aesthetic: ${t.isAesthetic}`);
    console.log(`  Keyword Match: ${t.keywordMatchEnabled}`);
    console.log(`  Description: ${t.description ? t.description.substring(0, 200) : "null"}`);
    if (t.pipelineSteps) {
      console.log(`  Pipeline Steps (${(t.pipelineSteps as unknown[]).length} steps):`);
      console.log(JSON.stringify(t.pipelineSteps, null, 4));
    } else {
      console.log(`  Pipeline Steps: NONE`);
    }
    if (t.quantityPrices) {
      console.log(`  Quantity Prices: ${JSON.stringify(t.quantityPrices)}`);
    }
    if (t.bookingWindows) {
      console.log(`  Booking Windows: ${JSON.stringify(t.bookingWindows)}`);
    }
  }

  // Ximendes
  console.log("\n\n========== CLÍNICA XIMENDES ==========\n");
  // Find Ximendes ID
  const { organizations } = await import("../src/infrastructure/db/schema");
  const orgs = await db.select().from(organizations);
  const ximendes = orgs.find(o => o.name.toLowerCase().includes("ximendes"));
  if (!ximendes) {
    console.log("Ximendes not found");
  } else {
    console.log(`Ximendes ID: ${ximendes.id}\n`);
    const ximendesTreatments = await db.select().from(treatments).where(eq(treatments.clinicId, ximendes.id));
    for (const t of ximendesTreatments) {
      console.log(`\n--- Treatment: ${t.name} ---`);
      console.log(`  ID: ${t.id}`);
      console.log(`  Duration: ${t.durationMinutes}min`);
      console.log(`  Requires Evaluation: ${t.requiresEvaluationFirst}`);
      console.log(`  Price Quotable: ${t.priceQuotableInChat}`);
      console.log(`  Price: ${t.priceCents ? `R$ ${(t.priceCents/100).toFixed(2)}` : "null"}`);
      console.log(`  Aliases: ${JSON.stringify(t.aliases)}`);
      console.log(`  Description: ${t.description ? t.description.substring(0, 200) : "null"}`);
      if (t.pipelineSteps) {
        console.log(`  Pipeline Steps (${(t.pipelineSteps as unknown[]).length} steps):`);
        console.log(JSON.stringify(t.pipelineSteps, null, 4));
      } else {
        console.log(`  Pipeline Steps: NONE`);
      }
    }
  }

  process.exit(0);
}

main().catch(console.error);
