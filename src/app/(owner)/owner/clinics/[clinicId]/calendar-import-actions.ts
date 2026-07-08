"use server";

import { db } from "@/infrastructure/db/client";
import { calendarImportTokens, organizations } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

export interface GenerateTokenResult {
  success: boolean;
  token?: string;
  url?: string;
  error?: string;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  errors: string[];
}

export async function generateCalendarImportToken(
  clinicId: string,
): Promise<GenerateTokenResult> {
  try {
    // Verificar se clínica existe
    const clinic = await db.query.organizations.findFirst({
      where: eq(organizations.id, clinicId),
      columns: { id: true, slug: true },
    });

    if (!clinic) {
      return { success: false, error: "Clínica não encontrada" };
    }

    // Gerar token único
    const token = crypto.randomBytes(32).toString("hex");

    // Calcular expiração (7 dias)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Salvar no DB
    await db.insert(calendarImportTokens).values({
      organizationId: clinicId,
      token,
      expiresAt,
    });

    // Gerar URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.systemops.ai";
    const url = `${baseUrl}/setup/calendar/${token}`;

    return {
      success: true,
      token,
      url,
    };
  } catch (error) {
    return {
      success: false,
      error: `Erro ao gerar token: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
