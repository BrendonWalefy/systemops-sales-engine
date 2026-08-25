import { NextRequest, NextResponse } from "next/server";
import { db } from "@/infrastructure/db/client";
import { calendarImportTokens, organizations } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { parseIcs } from "@/application/calendar/parse-ics";
import { importCalendarEvents } from "@/application/calendar/import-calendar-events";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;

    // Buscar token no DB
    const importToken = await db.query.calendarImportTokens.findFirst({
      where: eq(calendarImportTokens.token, token),
      columns: {
        organizationId: true,
        expiresAt: true,
      },
    });

    if (!importToken) {
      return NextResponse.json({ error: "Token inválido ou expirado" }, { status: 401 });
    }

    // Validar expiração
    if (new Date() > importToken.expiresAt) {
      return NextResponse.json({ error: "Token expirado" }, { status: 401 });
    }

    // Buscar clínica
    const clinic = await db.query.organizations.findFirst({
      where: eq(organizations.id, importToken.organizationId),
      columns: { id: true, name: true },
    });

    if (!clinic) {
      return NextResponse.json({ error: "Clínica não encontrada" }, { status: 404 });
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Arquivo não fornecido" }, { status: 400 });
    }

    if (!file.name.endsWith(".ics")) {
      return NextResponse.json(
        { error: "Arquivo deve ser um .ics válido" },
        { status: 400 },
      );
    }

    // Ler conteúdo do arquivo
    const content = await file.text();

    // Parsear ICS
    const parseResult = parseIcs(content);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          imported: 0,
          errors: parseResult.errors,
        },
        { status: 400 },
      );
    }

    // Importar eventos para DB
    const importResult = await importCalendarEvents(
      importToken.organizationId,
      parseResult.events,
    );

    return NextResponse.json({
      success: importResult.imported > 0 || importResult.errors.length === 0,
      imported: importResult.imported,
      skipped: importResult.skipped,
      errors: [
        ...parseResult.errors,
        ...importResult.errors.map((e) => `${e.event}: ${e.error}`),
      ],
      clinicName: clinic.name,
      message: `${importResult.imported} consultas importadas em ${clinic.name}${importResult.skipped > 0 ? ` (${importResult.skipped} puladas)` : ""}`,
    });
  } catch (error) {
    console.error("[setup-calendar-import] Erro:", error);
    return NextResponse.json(
      {
        success: false,
        imported: 0,
        errors: [
          `Erro no servidor: ${error instanceof Error ? error.message : String(error)}`,
        ],
      },
      { status: 500 },
    );
  }
}
