import { db } from "@/infrastructure/db/client";
import { appointments, leads, treatments, professionals } from "@/infrastructure/db/schema";
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
  // Profissional usado quando o SUMMARY não menciona nenhum profissional
  // cadastrado (agenda real da Vitalli: só 3 de 24 eventos futuros mencionam
  // "gregorie" no texto — os demais não indicam quem atende, então caem no
  // profissional padrão informado pelo chamador).
  defaultProfessionalId?: string;
}

export function normalizeCalendarEventId(calendarEventId: string): string {
  return calendarEventId.replace(/@google\.com$/, "");
}

export function calendarEventIdCandidates(calendarEventId: string): string[] {
  const normalized = normalizeCalendarEventId(calendarEventId);
  return [normalized, `${normalized}@google.com`];
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
    columns: {
      id: true, name: true, aliases: true, keywordMatchEnabled: true,
      pipelineSteps: true, durationMinutes: true,
    },
  });
  const treatmentCandidates: ImportTreatmentCandidate[] = clinicTreatments.map((t) => ({
    id: t.id,
    name: t.name,
    aliases: t.aliases,
    keywordMatchEnabled: t.keywordMatchEnabled,
    hasPipeline: (t.pipelineSteps?.length ?? 0) > 0,
  }));

  const clinicProfessionals = await db.query.professionals.findMany({
    where: eq(professionals.clinicId, clinicId),
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
      const treatmentMatch = matchImportedTreatment(treatmentName, treatmentCandidates);
      const matchedTreatment = treatmentMatch.treatmentId
        ? clinicTreatments.find((t) => t.id === treatmentMatch.treatmentId)
        : undefined;
      // Empate fica registrado: é o operador quem sabe qual técnica foi feita, e
      // sem esse log o evento sumiria sem tratamento e sem explicação.
      if (treatmentMatch.ambiguousWith.length > 0) {
        console.log(
          `[ImportCalendar] Tratamento ambíguo em "${event.summary}" — candidatos: ` +
          `${treatmentMatch.ambiguousWith.join(" | ")} (clinic=${clinicId})`,
        );
      }

      const matchedProfessional = clinicProfessionals.find((p) =>
        matchesProfessionalMention(normalizedSummary, normalizeProfessionalName(p.name)),
      );
      const professionalId = matchedProfessional?.id ?? options.defaultProfessionalId ?? null;

      const valueCents = extractEventValueCents(treatmentName);

      const endsAt = resolveImportedEndsAt({
        startsAt: event.startTime,
        eventEndsAt: event.endTime,
        treatmentDurationMinutes: matchedTreatment?.durationMinutes ?? null,
      });

      // Deduplication: check if an appointment with this calendarEventId already exists
      const existingAppointment = await db.query.appointments.findFirst({
        where: (appts, { eq, and, inArray }) =>
          and(
            eq(appts.clinicId, clinicId),
            inArray(appts.calendarEventId, calendarEventIdCandidates(event.uid)),
          ),
        columns: { id: true, professionalId: true, treatmentId: true, status: true, valueCents: true }
      });

      if (existingAppointment) {
        const updatedStatus =
          existingAppointment.status === "confirmed" ? "confirmed" : "scheduled";
        // Reimportação também corrige eventos que foram movidos/editados no Google.
        await db.update(appointments)
          .set({
            startsAt: event.startTime,
            // Reaplica no re-sync: sem isto, a primeira edição do evento no
            // Google devolveria o bloco curto e a proteção se perderia.
            endsAt,
            status: updatedStatus,
            professionalId: matchedProfessional?.id ?? existingAppointment.professionalId ?? options.defaultProfessionalId ?? null,
            treatmentId: matchedTreatment?.id ?? existingAppointment.treatmentId ?? null,
            // Não apaga valor já registrado quando o texto do evento perde a cifra.
            valueCents: valueCents ?? existingAppointment.valueCents ?? null,
            description: event.summary ?? null,
            updatedAt: new Date(),
          })
          .where(eq(appointments.id, existingAppointment.id));
        result.skipped++;
        continue;
      }

      const appointmentResult = await db.insert(appointments).values({
        clinicId,
        leadId,
        professionalId,
        startsAt: event.startTime,
        endsAt,
        status: "scheduled",
        source: "gcal_import",
        // Agendado FORA do sistema (telefone/presencial) e importado depois — não
        // é conversão do produto. Ver diagnóstico §8.
        origin: "gcal_import",
        treatmentId: matchedTreatment?.id ?? null,
        valueCents,
        description: event.summary ?? null,
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

// Texto do evento com pontuação virada em espaço: o SUMMARY real vem com "+",
// "/", "$" grudados nas palavras ("20 lentes + remoção", "lentes / pagou 100$").
function normalizeEventText(text: string): string {
  return normalizeWord(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Até quando a consulta importada ocupa a agenda INTERNA.
 *
 * A clínica agenda no Google e, na pressa, erra o bloco: das 23 consultas
 * futuras da Vitalli, **9 estavam mais curtas que o procedimento exige** — duas
 * delas com 60 minutos para uma instalação de lentes de 5 horas. Como o motor de
 * horários lê a agenda interna, ele via a tarde livre e podia ofertá-la a outro
 * lead enquanto o doutor ainda estava atendendo.
 *
 * Regra: `max(bloco do Google, duração cadastrada)`. Nunca encurta.
 *
 * A assimetria é o ponto. Estender um bloco custa uma vaga não ofertada;
 * encurtar custa dois pacientes no mesmo horário. E o bloco maior costuma ser
 * **procedimento combinado** — "Amanda 20 lentes + Remoção" (240min contra 90 de
 * cadastro), "Ana Cristina manutenção + limpeza" (60 contra 30). O doutor
 * reservou mais porque há mais; o cadastro guarda um tratamento por consulta e
 * não tem como saber disso.
 *
 * A agenda do Google não é tocada — só a nossa.
 */
export function resolveImportedEndsAt(params: {
  startsAt: Date;
  eventEndsAt: Date;
  treatmentDurationMinutes: number | null;
}): Date {
  const { startsAt, eventEndsAt, treatmentDurationMinutes } = params;
  if (!treatmentDurationMinutes || treatmentDurationMinutes <= 0) return eventEndsAt;
  const configuredEnd = new Date(startsAt.getTime() + treatmentDurationMinutes * 60_000);
  return configuredEnd > eventEndsAt ? configuredEnd : eventEndsAt;
}

/**
 * Valor do atendimento escrito no texto do evento, em centavos.
 *
 * A home soma `valueCents` para mostrar faturamento potencial e realizado. Medido
 * em 21/07: **45 de 46** consultas da Vitalli tinham `valueCents` nulo e os dois
 * números apareciam como R$ 0 — enquanto o valor estava escrito na agenda o tempo
 * todo ("Tatiana 20 lentes 2 mil", "Laís Manutenção R$400").
 *
 * Só extrai com **marcador explícito de dinheiro** — `R$`, `$` ou "mil". Número
 * solto é armadilha: "20 lentes" é quantidade, "8:30" é horário, e
 * "2500 se fizer raspagem 2650" são duas alternativas, não uma soma.
 *
 * Vários valores marcados **somam**: o evento itemiza um atendimento combinado
 * ("R$2.000 e plástica gengival R$1.000" = R$ 3.000 naquela cadeira).
 */
export function extractEventValueCents(summary: string): number | null {
  const text = summary.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const valores: number[] = [];

  const toNumber = (raw: string): number => Number(raw.replace(/\./g, "").replace(",", "."));

  for (const m of text.matchAll(/r\$\s*([\d.,]+)/g)) valores.push(toNumber(m[1]));
  for (const m of text.matchAll(/(\d[\d.,]*)\s*\$/g)) valores.push(toNumber(m[1]));
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*mil\b/g)) {
    valores.push(Number(m[1].replace(",", ".")) * 1000);
  }

  const validos = valores.filter((v) => Number.isFinite(v) && v > 0);
  if (validos.length === 0) return null;
  return Math.round(validos.reduce((a, b) => a + b, 0) * 100);
}

export type ImportTreatmentCandidate = {
  id: string;
  name: string;
  aliases?: string[] | null;
  keywordMatchEnabled?: boolean | null;
  // Entrada "guarda-chuva" da família: é ela que carrega o pipeline de conteúdo
  // e normalmente não é cotável sozinha. Desempata quando o texto cita a família
  // sem a técnica. Mesma convenção do matcher conversacional, que já prefere o
  // tratamento com pipeline (ConversationOrchestrator:matchTreatmentByNormalizedMessage).
  hasPipeline?: boolean | null;
};

export type ImportTreatmentMatch = {
  treatmentId: string | null;
  // Nomes dos tratamentos que empataram. Vazio quando houve match único ou
  // nenhum. Serve para registrar o caso — é decisão do operador, não nossa.
  ambiguousWith: string[];
};

/**
 * Qual tratamento cadastrado o texto livre do evento menciona?
 *
 * A regra anterior comparava só com o NOME COMPLETO do tratamento
 * (`summary.includes("Manutenção Preventiva de lentes")`). A agenda real não
 * escreve assim — escreve "Kevin Manutenção", "Ana Julia 20 lentes", "Keyla
 * remoção 20 lentes". Resultado medido: **0 de 44** eventos importados da
 * Vitalli tinham `treatmentId`, e as regras de pós-atendimento — que filtram por
 * tratamento — nunca encontravam ninguém. Nenhuma mensagem de cuidados pós-lentes
 * jamais saiu.
 *
 * Agora casa por nome OU alias, com dois desempates, nesta ordem:
 *
 * 1. **Especificidade** — vence o termo mais longo. "20 lentes estratificada"
 *    resolve para Estratificada mesmo com as três casando o alias "lentes".
 * 2. **Guarda-chuva da família** — quando a especificidade empata, vence o
 *    tratamento que carrega o pipeline de conteúdo. Foi o caso de 21 dos 44
 *    eventos, todos na forma "N lentes": a Vitalli tem três tratamentos de lente
 *    e o texto não diz a técnica. A entrada com pipeline (Lentes em Resina
 *    Composta) é justamente a genérica — não cotável sozinha, existe para
 *    representar a família. Registrar ela não é palpite: é o que o texto diz.
 *
 * Se nem isso desempatar, não resolve: devolve os candidatos e o operador decide.
 * Isto grava prontuário — inventar a técnica para fazer uma automação disparar
 * seria pior do que não disparar.
 */
export function matchImportedTreatment(
  summary: string,
  candidates: ImportTreatmentCandidate[],
): ImportTreatmentMatch {
  const text = normalizeEventText(summary);
  if (!text) return { treatmentId: null, ambiguousWith: [] };

  // Comprimento do termo mais ESPECÍFICO que este tratamento casou; 0 = não casou.
  //
  // A especificidade desempata: "20 lentes estratificada" casa os três
  // tratamentos de lente pelo alias genérico "lentes" (6 letras), mas só um casa
  // "estratificada" (13). O mais específico vence. Quando o topo empata — o caso
  // de "20 lentes", sem técnica escrita — ninguém vence, e é isso mesmo.
  const specificity = (candidate: ImportTreatmentCandidate): number => {
    if (candidate.keywordMatchEnabled === false) return 0;
    const terms = [candidate.name, ...(candidate.aliases ?? [])];
    let best = 0;
    for (const term of terms) {
      const normalized = normalizeEventText(term);
      if (normalized.length >= 4 && text.includes(normalized)) {
        best = Math.max(best, normalized.length);
      }
    }
    return best;
  };

  const scored = candidates
    .map((candidate) => ({ candidate, score: specificity(candidate) }))
    .filter((entry) => entry.score > 0);

  if (scored.length === 0) return { treatmentId: null, ambiguousWith: [] };

  const topScore = Math.max(...scored.map((entry) => entry.score));
  const winners = scored.filter((entry) => entry.score === topScore);

  if (winners.length === 1) return { treatmentId: winners[0].candidate.id, ambiguousWith: [] };

  // Empate na especificidade: o texto citou a família sem a técnica. Vence o
  // guarda-chuva, se houver exatamente um.
  const umbrellas = winners.filter((entry) => entry.candidate.hasPipeline === true);
  if (umbrellas.length === 1) return { treatmentId: umbrellas[0].candidate.id, ambiguousWith: [] };
  return { treatmentId: null, ambiguousWith: winners.map((entry) => entry.candidate.name) };
}

// "Dr. Gregorie" → "gregorie" — o SUMMARY real menciona só o núcleo do nome
// ("avaliação gregorie", "já pagou GREGORI"), nunca com o prefixo "Dr./Dra.".
function normalizeProfessionalName(name: string): string {
  return normalizeWord(name).replace(/^dra?\.?\s+/, "");
}

// Tolerância a variação de digitação real: "Polyane 20 lentes já pagou
// GREGORI" (sem o "e" final) não bate com includes("gregorie") direto —
// checa também o nome sem a última letra.
function matchesProfessionalMention(normalizedSummary: string, professionalCore: string): boolean {
  if (!professionalCore) return false;
  if (normalizedSummary.includes(professionalCore)) return true;
  return professionalCore.length >= 5 && normalizedSummary.includes(professionalCore.slice(0, -1));
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
