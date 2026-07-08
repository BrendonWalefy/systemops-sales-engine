import { NextRequest, NextResponse } from "next/server";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { parseIcs } from "@/application/calendar/parse-ics";
import { importCalendarEvents } from "@/application/calendar/import-calendar-events";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clinicId: string }> },
) {
  try {
    // Validar autenticação
    const sessionClinicId = await getSessionClinicId();
    if (!sessionClinicId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { clinicId } = await params;

    // Validar que a clínica da sessão corresponds ao clinicId da URL
    if (clinicId !== sessionClinicId) {
      return NextResponse.json({ error: "Proibido" }, { status: 403 });
    }

    // Verificar se clínica existe
    const clinic = await db.query.organizations.findFirst({
      where: eq(organizations.id, clinicId),
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
    const importResult = await importCalendarEvents(clinicId, parseResult.events);

    return NextResponse.json({
      success: importResult.imported > 0 || importResult.errors.length === 0,
      imported: importResult.imported,
      skipped: importResult.skipped,
      errors: [
        ...parseResult.errors,
        ...importResult.errors.map((e) => `${e.event}: ${e.error}`),
      ],
      message: `${importResult.imported} consultas importadas${importResult.skipped > 0 ? `, ${importResult.skipped} puladas` : ""}`,
    });
  } catch (error) {
    console.error("[import-calendar] Erro:", error);
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
