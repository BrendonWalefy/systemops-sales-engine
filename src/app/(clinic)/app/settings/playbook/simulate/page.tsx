export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { organizations } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { SimulateClient } from "./simulate-client";
import { DEFAULT_MENU_ITEMS, type MenuItem } from "@/domain/entities/clinic";

export default async function SimulatePage() {
  const clinicId = await requireSessionClinicId();
  const clinic = await db
    .select({ name: organizations.name, menuItems: organizations.menuItems })
    .from(organizations)
    .where(eq(organizations.id, clinicId))
    .limit(1)
    .then((r) => r[0] ?? null);

  const menuItems = (clinic?.menuItems as MenuItem[] | null) ?? DEFAULT_MENU_ITEMS;

  return (
    <SimulateClient
      clinicId={clinicId}
      clinicName={clinic?.name ?? "Clínica"}
      menuItems={menuItems}
    />
  );
}
