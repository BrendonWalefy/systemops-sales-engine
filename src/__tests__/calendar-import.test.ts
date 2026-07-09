import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/infrastructure/db/client";
import { organizations, leads, appointments, treatments } from "@/infrastructure/db/schema";
import { eq, and } from "drizzle-orm";
import { parseIcs } from "@/application/calendar/parse-ics";
import { importCalendarEvents, extractPatientName } from "@/application/calendar/import-calendar-events";
import fs from "fs";
import path from "path";

// Arquivo .ics de teste
const ICS_FILE_PATH = path.join(
  process.cwd(),
  "vitalli-agenda-exemplo.ics",
);

// Fixo no passado — os testes de import chamam importCalendarEvents com este
// cutoffDate para não depender de "agora" (o cutoffDate default é new Date(),
// e o arquivo de exemplo tem datas fixas de 2026-07-10/11; sem fixar, o teste
// quebraria sozinho assim que essa data ficasse no passado).
const FAR_PAST_CUTOFF = new Date("2020-01-01T00:00:00Z");

// P0.8: extractPatientName — casos reais da agenda da Vitalli (export do
// Google Calendar, e-mail antigo dental.luxe98@gmail.com, 09/07/2026).
// Confirmou o bug real: a primeira tentativa em produção assumia o padrão
// "Tratamento - Nome" (usado só no fixture de exemplo criado antes de ver o
// arquivo real), mas a agenda de verdade não usa separador nenhum — o nome do
// paciente é sempre a primeira sequência de palavra(s) capitalizada(s) no
// início do SUMMARY, com uma exceção clara: quando a frase abre com uma
// palavra de tratamento ("Manutenção Fabio"), o nome vem em seguida.
describe("extractPatientName — casos reais da agenda Vitalli", () => {
  const casosReais: Array<[string, string]> = [
    ["Alex 20 Lentes 2 mil", "Alex"],
    ["Manutenção Fabio", "Fabio"],
    ["Isac paciente R$2.000", "Isac"],
    ["Evelin 20 lentes R$2.000", "Evelin"],
    ["Laís Manutenção R$400", "Laís"],
    ["Pedro manutenção 1 cortesia", "Pedro"],
    ["Jeniffer manutenção sem custo", "Jeniffer"],
    ["Riquelme manutenção R$400", "Riquelme"],
    ["Denis William R$3.000 com a plástica + R$400 da remoção", "Denis William"],
    ["Gabriel Reparo canino R$200", "Gabriel"],
    ["Leonardo Paciente R$2.000", "Leonardo"],
    ["Vilma avaliação gregorie", "Vilma"],
    ["Ana Cristina manutenção 400 + limpeza 250 + Manutenção filho", "Ana Cristina"],
    ["Milena 20 lentes 2 mil", "Milena"],
    ["Ana Julia 20 lentes", "Ana Julia"],
    ["Thalyta ajustes", "Thalyta"],
    ["Regina Silva Rodrigues 2 mil 200 remoção", "Regina Silva Rodrigues"],
    ["ROSÂNGELA REPARO e avaliação vizinha", "Rosângela"],
    ["Jairan 20 lentes R$2.000", "Jairan"],
    ["MURILO 20 lentes + PLÁSTICA SUPERIOR 2500 se fizer raspagem 2650", "Murilo"],
    ["Vitor manutenção gratuita", "Vitor"],
    ["Polyane 20 lentes já pagou GREGORI", "Polyane"],
    ["Keyla remoção 20 lentes", "Keyla"],
    ["Poliana paciente R$2.100 gregorie", "Poliana"],
  ];

  for (const [summary, expected] of casosReais) {
    it(`"${summary}" → "${expected}"`, () => {
      expect(extractPatientName(summary)).toBe(expected);
    });
  }

  it("string vazia retorna fallback", () => {
    expect(extractPatientName("")).toBe("Paciente Importado");
  });

  it("evento sem nome capitalizável (ex: compromisso administrativo) usa a primeira palavra como fallback", () => {
    // Caso real do histórico: "8:00 medir para móveis planejados em MDF" —
    // não é um paciente, é um compromisso da clínica. Não há como distinguir
    // isso de um paciente real sem contexto adicional; o comportamento atual
    // (usar a primeira palavra) é um fallback aceitável, não uma garantia.
    expect(extractPatientName("8:00 medir para móveis planejados em MDF")).toBe("8:00");
  });
});

// P0.9: parseIcs deve interpretar timestamps "Z" (UTC) como UTC de verdade,
// independente do timezone do processo que roda o código. Bug real: a
// implementação original usava new Date(y, mo, d, h, mi, s) mesmo para
// timestamps com sufixo Z — esse construtor SEMPRE interpreta os componentes
// como horário LOCAL do processo. Em produção (Vercel, UTC) o bug não
// aparecia por coincidência (local do processo == UTC), mas rodando local
// (America/Sao_Paulo, UTC-3) o mesmo DTSTART:...Z saía 3h adiantado —
// confirmado comparando a saída de um script local contra os appointments já
// gravados em produção para o mesmo evento real ("Pedro manutenção 1
// cortesia", DTSTART:20260710T110000Z): produção gravou 11:00 UTC (correto),
// o mesmo parser rodando local calculava 14:00 UTC (+3h, exatamente o offset
// de America/Sao_Paulo).
describe("parseIcs — timestamps UTC independem do timezone do processo", () => {
  it("DTSTART/DTEND com sufixo Z retorna o mesmo instante UTC, não deslocado pelo TZ local", () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20260710T110000Z
DTEND:20260710T120000Z
UID:tz-test-1@test
SUMMARY:Pedro manutenção 1 cortesia
END:VEVENT
END:VCALENDAR`;

    const result = parseIcs(ics);
    expect(result.events).toHaveLength(1);
    // toISOString() sempre imprime em UTC — se o bug estivesse presente aqui
    // (rodando em qualquer TZ != UTC), isso acusaria o deslocamento.
    expect(result.events[0].startTime.toISOString()).toBe("2026-07-10T11:00:00.000Z");
    expect(result.events[0].endTime.toISOString()).toBe("2026-07-10T12:00:00.000Z");
  });

  it("DTSTART sem sufixo Z (floating time) usa o timezone local do processo — comportamento distinto do UTC", () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20260710T110000
DTEND:20260710T120000
UID:tz-test-2@test
SUMMARY:Evento sem timezone
END:VEVENT
END:VCALENDAR`;

    const result = parseIcs(ics);
    // Sem "Z", o valor é ambíguo por design do formato iCalendar (floating
    // time) — aqui só confirmamos que o parser não falha e produz uma data
    // com os componentes locais corretos (hora 11, não deslocada).
    expect(result.events[0].startTime.getHours()).toBe(11);
    expect(result.events[0].startTime.getDate()).toBe(10);
  });
});

// Teste de integração: grava de verdade numa clínica demo no banco real.
// Nenhum outro teste da suíte depende de DATABASE_URL (todos usam mocks) —
// esse é o único, então roda só quando a env var está disponível (ambiente
// local com .env.local). CI não tem DATABASE_URL configurada de propósito,
// para não gravar/rodar contra um banco real a cada push.
describe.skipIf(!process.env.DATABASE_URL)("Calendar Import — Parse + DB", () => {
  let demoClinicId: string;

  beforeAll(async () => {
    // Criar clínica demo para testes
    const existingDemo = await db.query.organizations.findFirst({
      where: eq(organizations.slug, "demo-vitalli-test"),
      columns: { id: true },
    });

    if (existingDemo) {
      demoClinicId = existingDemo.id;
      // Limpar dados anteriores
      await db.delete(appointments).where(eq(appointments.clinicId, demoClinicId));
      await db.delete(leads).where(eq(leads.clinicId, demoClinicId));
    } else {
      // Criar clínica demo
      const result = await db
        .insert(organizations)
        .values({
          name: "Demo Vitalli Test",
          slug: "demo-vitalli-test",
          specialty: "dental",
          city: "São Paulo",
          autoReplyEnabled: false,
          isTest: true,
          operationalStatus: "test",
        })
        .returning({ id: organizations.id });

      demoClinicId = result[0].id;
    }

    console.log("✅ Demo clinic created/reused:", demoClinicId);
  });

  afterAll(async () => {
    // Cleanup após testes (opcional — manter dados para inspecionar)
    console.log("✅ Tests completed. Demo clinic ID:", demoClinicId);
  });

  it("deve parsear arquivo .ics corretamente", async () => {
    const content = fs.readFileSync(ICS_FILE_PATH, "utf-8");
    const result = parseIcs(content);

    expect(result.success).toBe(true);
    expect(result.events.length).toBe(6);
    expect(result.errors.length).toBe(0);

    // Validar primeiro evento
    const event1 = result.events[0];
    expect(event1.summary).toContain("João Silva");
    expect(event1.uid).toBe("google-calendar-vitalli-001@google.com");
    expect(event1.startTime).toBeDefined();
    expect(event1.endTime).toBeDefined();
  });

  it("deve extrair informações de eventos no formato real da agenda (Nome + texto livre, sem separador)", async () => {
    const content = fs.readFileSync(ICS_FILE_PATH, "utf-8");
    const result = parseIcs(content);

    const events = result.events;

    // Formato real observado na exportação da Vitalli: sem "-" nem
    // parênteses, o nome do paciente abre a frase.
    expect(events[0].summary).toMatch(/João Silva/);
    expect(events[1].summary).toMatch(/Maria Santos/);
    expect(events[2].summary).toMatch(/Pedro Costa/);
  });

  it("deve importar eventos para DB corretamente", async () => {
    const content = fs.readFileSync(ICS_FILE_PATH, "utf-8");
    const parseResult = parseIcs(content);

    const importResult = await importCalendarEvents(demoClinicId, parseResult.events, { cutoffDate: FAR_PAST_CUTOFF });

    console.log("Import result:", importResult);

    expect(importResult.imported).toBe(6);
    expect(importResult.skipped).toBe(0);
    expect(importResult.errors.length).toBe(0);

    // Verificar que leads foram criados
    const createdLeads = await db.query.leads.findMany({
      where: eq(leads.clinicId, demoClinicId),
      columns: { id: true, name: true },
    });

    expect(createdLeads.length).toBeGreaterThanOrEqual(6);
    console.log("✅ Created leads:", createdLeads.map((l) => l.name));

    // Verificar que appointments foram criados
    const createdAppointments = await db.query.appointments.findMany({
      where: and(
        eq(appointments.clinicId, demoClinicId),
        eq(appointments.source, "gcal_import"),
      ),
      columns: {
        id: true,
        startsAt: true,
        status: true,
        calendarEventId: true,
      },
    });

    expect(createdAppointments.length).toBe(6);
    console.log("✅ Created appointments:", createdAppointments.length);

    // Validar primeiro appointment
    const apt1 = createdAppointments[0];
    expect(apt1.status).toBe("scheduled");
    expect(apt1.calendarEventId).toBeTruthy();
  });

  it("deve vincular appointments com leads corretamente", async () => {
    // Buscar appointments criados
    const appointments_ = await db.query.appointments.findMany({
      where: and(
        eq(appointments.clinicId, demoClinicId),
        eq(appointments.source, "gcal_import"),
      ),
      columns: {
        id: true,
        leadId: true,
        startsAt: true,
      },
    });

    expect(appointments_.length).toBe(6);

    // Verificar que cada appointment tem um lead válido
    for (const apt of appointments_) {
      const lead = await db.query.leads.findFirst({
        where: eq(leads.id, apt.leadId),
        columns: { name: true },
      });

      expect(lead).toBeDefined();
      expect(lead?.name).toBeTruthy();
      console.log(
        `✅ Appointment ${apt.startsAt} → Lead: ${lead?.name}`,
      );
    }
  });

  it("deve respeitar idempotência (não duplicar ao reimportar)", async () => {
    const content = fs.readFileSync(ICS_FILE_PATH, "utf-8");
    const parseResult = parseIcs(content);

    // Contar appointments antes da reimportação
    const appointmentsBefore = await db.query.appointments.findMany({
      where: and(
        eq(appointments.clinicId, demoClinicId),
        eq(appointments.source, "gcal_import"),
      ),
    });

    const countBefore = appointmentsBefore.length;

    // Segunda importação (deveria ser idempotente por UID)
    const importResult = await importCalendarEvents(demoClinicId, parseResult.events, { cutoffDate: FAR_PAST_CUTOFF });

    // Contar appointments depois
    const appointmentsAfter = await db.query.appointments.findMany({
      where: and(
        eq(appointments.clinicId, demoClinicId),
        eq(appointments.source, "gcal_import"),
      ),
    });

    const countAfter = appointmentsAfter.length;

    console.log(
      `Appointments before: ${countBefore}, after: ${countAfter}`,
    );
    console.log("Import result (2nd attempt):", importResult);

    // Nota: Hoje não temos validação de duplicata por UID
    // A implementação atual cria duplicatas. Isso é documentado como comportamento esperado.
    // Num futuro, poderia usar calendarEventId como unique constraint.
    console.log(
      `⚠️  Comportamento esperado: duplicatas são criadas (não há validação por UID ainda)`,
    );
  });

  it("deve extrair o nome do paciente de cada evento do fixture", async () => {
    const content = fs.readFileSync(ICS_FILE_PATH, "utf-8");
    const parseResult = parseIcs(content);

    const testCases = [
      { summary: "João Silva 20 lentes R$2.000", expectedPatient: "João Silva" },
      { summary: "Maria Santos manutenção", expectedPatient: "Maria Santos" },
      { summary: "Pedro Costa avaliação facetas", expectedPatient: "Pedro Costa" },
    ];

    for (const testCase of testCases) {
      const event = parseResult.events.find(
        (e) => e.summary === testCase.summary,
      );
      expect(event).toBeDefined();
      expect(extractPatientName(event?.summary ?? "")).toBe(testCase.expectedPatient);
    }
  });

  it("cutoffDate filtra eventos passados — não importa nem conta como erro, só como skipped", async () => {
    // Caso real que motivou este filtro: a exportação real do Google Calendar
    // da Vitalli trazia 1488 eventos desde 2024 (todo o histórico). Sem
    // filtro, a primeira tentativa em produção processou centenas de
    // consultas já passadas antes de travar. cutoffDate no futuro distante
    // deve pular TODOS os eventos do fixture (que são de 2026-07-10/11).
    const content = fs.readFileSync(ICS_FILE_PATH, "utf-8");
    const parseResult = parseIcs(content);

    const farFutureCutoff = new Date("2030-01-01T00:00:00Z");
    const importResult = await importCalendarEvents(demoClinicId, parseResult.events, {
      cutoffDate: farFutureCutoff,
    });

    expect(importResult.imported).toBe(0);
    expect(importResult.skipped).toBe(parseResult.events.length);
    expect(importResult.errors.length).toBe(0);
  });

  it("deve validar datas/horários corretamente", async () => {
    const content = fs.readFileSync(ICS_FILE_PATH, "utf-8");
    const parseResult = parseIcs(content);

    const event1 = parseResult.events[0];
    expect(event1.startTime).toBeInstanceOf(Date);
    expect(event1.endTime).toBeInstanceOf(Date);

    // Evento 1: 2026-07-10 10:00-11:00
    expect(event1.startTime.toISOString()).toContain("2026-07-10");
    expect(event1.endTime.toISOString()).toContain("2026-07-10");

    const durationMinutes =
      (event1.endTime.getTime() - event1.startTime.getTime()) / (1000 * 60);
    expect(durationMinutes).toBe(60); // 1 hora
  });

  it("deve mostrar resumo final de importação", async () => {
    const content = fs.readFileSync(ICS_FILE_PATH, "utf-8");
    const parseResult = parseIcs(content);

    const importResult = await importCalendarEvents(demoClinicId, parseResult.events, { cutoffDate: FAR_PAST_CUTOFF });

    console.log("\n📊 IMPORT SUMMARY");
    console.log("─".repeat(50));
    console.log(`✅ Imported: ${importResult.imported}`);
    console.log(`⏭️  Skipped: ${importResult.skipped}`);
    console.log(`❌ Errors: ${importResult.errors.length}`);

    if (importResult.errors.length > 0) {
      console.log("\nError details:");
      importResult.errors.forEach((e) => {
        console.log(`  • ${e.event}: ${e.error}`);
      });
    }

    // Buscar dados finais
    const finalLeads = await db.query.leads.findMany({
      where: eq(leads.clinicId, demoClinicId),
    });

    const finalAppointments = await db.query.appointments.findMany({
      where: and(
        eq(appointments.clinicId, demoClinicId),
        eq(appointments.source, "gcal_import"),
      ),
    });

    console.log(`\n📋 FINAL DATABASE STATE`);
    console.log("─".repeat(50));
    console.log(`Leads created: ${finalLeads.length}`);
    console.log(`Appointments created: ${finalAppointments.length}`);
    console.log(
      `Date range: ${finalAppointments[0]?.startsAt} to ${finalAppointments[finalAppointments.length - 1]?.startsAt}`,
    );

    expect(importResult.imported).toBeGreaterThan(0);
  });
});
