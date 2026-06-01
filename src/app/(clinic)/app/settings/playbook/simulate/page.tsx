export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { SimulateClient } from "./simulate-client";

export default async function SimulatePage() {
  const clinicId = process.env.PILOT_CLINIC_ID!;
  const clinic = await db
    .select({ name: clinics.name })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1)
    .then((r) => r[0] ?? null);

  return <SimulateClient clinicId={clinicId} clinicName={clinic?.name ?? "Clínica"} />;
}
