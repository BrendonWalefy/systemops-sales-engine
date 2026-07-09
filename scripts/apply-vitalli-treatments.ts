import { db } from "../src/infrastructure/db/client";
import { treatments } from "../src/infrastructure/db/schema";
import { eq, and, inArray } from "drizzle-orm";

async function main() {
  const clinicId = "d24a584a-faac-4a46-9750-a718d0f8e686"; // Clínica Vitalli

  console.log("Deletando tratamentos genéricos antigos...");
  await db.delete(treatments).where(
    and(
      eq(treatments.clinicId, clinicId),
      inArray(treatments.name, ["Exodontia (Extração de Siso)", "Clareamento Dental", "Prótese Dentária"])
    )
  );

  console.log("Atualizando tratamentos existentes...");
  // Substituição de lentes
  await db.update(treatments).set({
    name: "Substituição de lente (un)",
    priceCents: 20000,
    priceKind: "fixed",
    priceQuotableInChat: true
  }).where(
    and(eq(treatments.clinicId, clinicId), eq(treatments.name, "Substituição de lentes"))
  );

  // Implante Dentário -> Implante
  await db.update(treatments).set({
    name: "Implante",
    priceCents: 250000,
    priceKind: "fixed",
    priceQuotableInChat: true
  }).where(
    and(eq(treatments.clinicId, clinicId), eq(treatments.name, "Implante Dentário"))
  );

  // Restauração Estética
  await db.update(treatments).set({
    priceCents: 40000,
    priceKind: "fixed",
    priceQuotableInChat: true
  }).where(
    and(eq(treatments.clinicId, clinicId), eq(treatments.name, "Restauração Estética"))
  );

  console.log("Inserindo novos tratamentos...");
  const newTreatments = [
    { name: "Clareamento caseiro", priceCents: 60000, priceKind: "fixed", priceQuotableInChat: true, clinicId },
    { name: "Clareamento consultório", priceCents: 120000, priceKind: "fixed", priceQuotableInChat: true, clinicId },
    { name: "Clareamento consultório e caseiro", priceCents: 150000, priceKind: "fixed", priceQuotableInChat: true, clinicId },
    { name: "Siso normal", priceCents: 40000, priceKind: "fixed", priceQuotableInChat: true, clinicId },
    { name: "Siso incluso", priceCents: 60000, priceKind: "fixed", priceQuotableInChat: true, clinicId },
    { name: "Siso impactado", priceCents: 100000, priceKind: "fixed", priceQuotableInChat: true, clinicId },
    { name: "Prótese flexível", priceCents: 180000, priceKind: "fixed", priceQuotableInChat: true, clinicId },
    { name: "Prótese grampo", priceCents: 140000, priceKind: "fixed", priceQuotableInChat: true, clinicId },
  ] as const;

  for (const t of newTreatments) {
    // Check if it exists just in case
    const existing = await db.select().from(treatments).where(and(eq(treatments.clinicId, clinicId), eq(treatments.name, t.name)));
    if (existing.length === 0) {
      await db.insert(treatments).values({
        name: t.name,
        priceCents: t.priceCents,
        priceKind: t.priceKind,
        priceQuotableInChat: t.priceQuotableInChat,
        clinicId: t.clinicId
      });
      console.log(`Inserido: ${t.name}`);
    } else {
      console.log(`Já existe, atualizando: ${t.name}`);
      await db.update(treatments).set({
        priceCents: t.priceCents,
        priceKind: t.priceKind,
        priceQuotableInChat: t.priceQuotableInChat
      }).where(and(eq(treatments.clinicId, clinicId), eq(treatments.name, t.name)));
    }
  }

  console.log("Pronto!");
  process.exit(0);
}

main().catch(console.error);
