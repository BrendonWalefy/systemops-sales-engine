import { db } from "@/infrastructure/db/client";
import { appointments, leads, treatments } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import type { CalendarEvent } from "./parse-ics";

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ event: string; error: string }>;
}

export interface ImportOptions {
  // Exportações reais do Google Calendar trazem TODO o histórico (a agenda
  // real da Vitalli tinha 1488 eventos desde 2024 — importar tudo é lento
  // (processamento sequencial, 1 req/evento) e polui o banco com consultas
  // já passadas sem valor operacional. Default: só a partir de agora.
  cutoffDate?: Date;
}

export async function importCalendarEvents(
  clinicId: string,
  events: CalendarEvent[],
  options: ImportOptions = {},
): Promise<ImportResult> {
  const cutoffDate = options.cutoffDate ?? new Date();
  const relevantEvents = events.filter((e) => e.startTime >= cutoffDate);

  const result: ImportResult = {
    imported: 0,
    skipped: events.length - relevantEvents.length,
    errors: [],
  };

  // Carrega leads e treatments da clínica UMA VEZ (não por evento) — com o
  // driver HTTP do Neon cada query é um round-trip completo, e o volume real
  // exportado pelo Google Calendar pode ser grande mesmo após o filtro de
  // data. Fazer 2 queries de carga + N inserts em vez de ~3N queries evita o
  // travamento observado na primeira tentativa em produção (1488 eventos,
  // ~1/segundo, função serverless perto do limite de tempo).
  const existingLeads = await db.query.leads.findMany({
    where: eq(leads.clinicId, clinicId),
    columns: { id: true, name: true },
  });
  const leadByNormalizedName = new Map(
    existingLeads
      .filter((l) => l.name)
      .map((l) => [normalizeWord(l.name as string), l.id]),
  );

  const clinicTreatments = await db.query.treatments.findMany({
    where: eq(treatments.clinicId, clinicId),
    columns: { id: true, name: true },
  });

  for (const event of relevantEvents) {
    try {
      const { patientName, treatmentName } = extractEventInfo(event);
      const normalizedName = normalizeWord(patientName);

      let leadId = leadByNormalizedName.get(normalizedName);

      if (!leadId) {
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

        leadId = newLeadResult[0].id;
        leadByNormalizedName.set(normalizedName, leadId);
      }

      // Busca fuzzy em memória: qual tratamento cadastrado aparece dentro do
      // texto livre do evento (não o inverso — o SUMMARY não é um nome exato
      // de tratamento, é uma frase que pode mencioná-lo em qualquer posição).
      const normalizedSummary = normalizeWord(treatmentName);
      const matchedTreatment = clinicTreatments.find((t) =>
        normalizedSummary.includes(normalizeWord(t.name)),
      );

      const appointmentResult = await db.insert(appointments).values({
        clinicId,
        leadId,
        startsAt: event.startTime,
        endsAt: event.endTime,
        status: "scheduled",
        source: "gcal_import",
        treatmentId: matchedTreatment?.id ?? null,
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

// Vocabulário de tratamento/contexto que aparece ANTES ou DEPOIS do nome no
// SUMMARY real da Vitalli (ex: "Manutenção Fabio", "Isac paciente R$2.000").
// Baseado nos 26 eventos futuros reais da agenda (Dental Luxe/Vitalli, export
// de 09/07/2026) — não existe separador consistente (nem "-", nem ":"), o
// nome do paciente é sempre a primeira sequência de palavra(s) capitalizada(s)
// no início do texto, ou a próxima palavra capitalizada quando o SUMMARY abre
// com uma dessas keywords.
const TREATMENT_KEYWORDS = [
  "manutencao", "avaliacao", "reparo", "reparos", "ajuste", "ajustes",
  "implante", "implantes", "clareamento", "restauracao", "protese",
  "canal", "extracao", "remocao", "limpeza", "raspagem", "consulta",
  "paciente", "lentes", "lente",
];

function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function toTitleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function extractPatientName(summary: string): string {
  const words = summary.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "Paciente Importado";

  // "Manutenção Fabio" — tratamento abre a frase, nome vem na sequência.
  if (TREATMENT_KEYWORDS.includes(normalizeWord(words[0]))) {
    const nextCapitalized = words.slice(1).find((w) => /^[A-ZÀ-Ú]/.test(w));
    return nextCapitalized ? toTitleCase(nextCapitalized) : toTitleCase(words[0]);
  }

  // Caso comum: nome = sequência de palavras capitalizadas no início, até
  // encontrar keyword de tratamento, valor ("R$...") ou número solto (ex:
  // "20 lentes"). Limite de 3 palavras cobre nomes compostos reais
  // ("Regina Silva Rodrigues") sem arriscar engolir o resto da frase.
  const nameWords: string[] = [];
  for (const word of words) {
    if (TREATMENT_KEYWORDS.includes(normalizeWord(word))) break;
    if (/^r\$/i.test(word)) break;
    if (/^\d/.test(word)) break;
    if (!/^[A-ZÀ-Ú]/.test(word)) break;
    nameWords.push(word);
    if (nameWords.length >= 3) break;
  }

  if (nameWords.length === 0) return toTitleCase(words[0]);
  return nameWords.map(toTitleCase).join(" ");
}

function extractEventInfo(event: CalendarEvent): {
  patientName: string;
  treatmentName: string;
} {
  const summary = event.summary || "";
  const patientName = extractPatientName(summary) || "Paciente Importado";

  // Não há como separar "tratamento" do resto do texto com confiança (a
  // frase mistura valor, procedimento e observações livres) — usar o
  // SUMMARY inteiro como texto de busca fuzzy contra o catálogo é mais
  // seguro que tentar recortar um substring específico.
  const treatmentName = summary;

  return { patientName, treatmentName };
}
