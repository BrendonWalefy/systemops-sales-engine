import { db } from "@/infrastructure/db/client";
import { appointments, leads, treatments } from "@/infrastructure/db/schema";
import { eq, and, ilike } from "drizzle-orm";
import type { CalendarEvent } from "./parse-ics";

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ event: string; error: string }>;
}

export async function importCalendarEvents(
  clinicId: string,
  events: CalendarEvent[],
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    skipped: 0,
    errors: [],
  };

  for (const event of events) {
    try {
      // Extrair informações do evento
      const { patientName, treatmentName } = extractEventInfo(event);

      // Buscar ou criar lead
      let lead = await db.query.leads.findFirst({
        where: and(
          eq(leads.clinicId, clinicId),
          ilike(leads.name, patientName),
        ),
        columns: { id: true },
      });

      if (!lead) {
        // Criar novo lead de importação
        const newLeadResult = await db.insert(leads).values({
          clinicId,
          name: patientName,
          phone: null,
          email: null,
          channel: "manual",
          temperature: "warm",
        }).returning({ id: leads.id });

        if (!newLeadResult.length) {
          result.errors.push({
            event: event.summary,
            error: "Falha ao criar lead",
          });
          continue;
        }

        lead = { id: newLeadResult[0].id };
      }

      // Buscar treatment por nome (busca fuzzy)
      let treatment = null;
      if (treatmentName) {
        treatment = await db.query.treatments.findFirst({
          where: and(
            eq(treatments.clinicId, clinicId),
            ilike(treatments.name, `%${treatmentName}%`),
          ),
          columns: { id: true },
        });
      }

      // Criar appointment
      const appointmentResult = await db.insert(appointments).values({
        clinicId,
        leadId: lead.id,
        startsAt: event.startTime,
        endsAt: event.endTime,
        status: "scheduled",
        source: "gcal_import",
        treatmentId: treatment?.id || null,
        calendarEventId: event.uid,
      }).returning({ id: appointments.id });

      if (appointmentResult.length) {
        result.imported++;
      } else {
        result.errors.push({
          event: event.summary,
          error: "Falha ao criar agendamento",
        });
      }
    } catch (error) {
      result.errors.push({
        event: event.summary,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

function extractEventInfo(event: CalendarEvent): {
  patientName: string;
  treatmentName: string;
} {
  // Tentar extrair do SUMMARY: "Consulta - Lentes (João Silva)"
  // Ou: "João Silva - Lentes"
  // Ou genérico: "Consulta"

  let patientName = "Paciente Importado";
  let treatmentName = "";

  const summary = event.summary || "";
  const description = event.description || "";

  // Padrão: "Tratamento - Nome" ou "Nome - Tratamento"
  const parts = summary.split("-").map((p) => p.trim());

  if (parts.length >= 2) {
    // Tenta identificar qual é nome e qual é tratamento
    patientName = parts[parts.length - 1]; // último é geralmente o nome
    treatmentName = parts.slice(0, -1).join(" "); // resto é tratamento
  } else if (parts.length === 1) {
    // Apenas um campo, tenta extrair do description
    treatmentName = parts[0];
    // Buscar nome no description (ex: "Paciente: João Silva")
    const nameMatch = description.match(/(?:paciente|patient|nome|name):\s*([^\n]+)/i);
    if (nameMatch) {
      patientName = nameMatch[1].trim();
    }
  }

  // Fallback: usar summary como nome se estiver vazio
  if (patientName === "Paciente Importado" && summary) {
    patientName = summary.substring(0, 50); // primeiros 50 chars
  }

  return {
    patientName: patientName || "Paciente Importado",
    treatmentName: treatmentName || "",
  };
}
