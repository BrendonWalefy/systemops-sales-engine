"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import {
  seedDemoClinic,
  type DemoSeedResult,
} from "@/application/demo/seed-demo-clinic";

async function requireOwner(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  return session?.role === "owner";
}

export type LoadDemoState = {
  ok: boolean;
  message?: string;
  result?: DemoSeedResult;
};

export async function loadDemoClinic(
  previousState: LoadDemoState,
  formData: FormData,
): Promise<LoadDemoState> {
  void previousState;
  void formData;
  if (!(await requireOwner())) {
    return { ok: false, message: "Apenas o owner pode carregar a organização demo." };
  }

  try {
    const result = await seedDemoClinic();
    revalidatePath("/owner");
    return {
      ok: true,
      result,
      message: `Odonto Marques carregada: ${result.counts.leads} leads, ${result.counts.appointments} agendamentos, ${result.counts.conversations} conversas.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Falha ao carregar a demo: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
