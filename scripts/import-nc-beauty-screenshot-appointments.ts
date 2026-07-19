// Import único de agendamentos reais da NC Beauty & Clinic (15–31/07/2026),
// transcritos manualmente de prints do app "Minha Agenda" que a cliente
// enviou — ela não conseguiu exportar nenhum arquivo (.ics) para o fluxo
// normal de import-calendar-events.ts, então este script reproduz a mesma
// lógica (lead por nome normalizado, match de treatment, dedup idempotente)
// a partir de dados digitados à mão em vez de um arquivo.
//
// Rodar com: dotenv -e .env.local -- tsx scripts/import-nc-beauty-screenshot-appointments.ts

import { db } from "@/infrastructure/db/client";
import { appointments, leads, treatments, professionals, organizations } from "@/infrastructure/db/schema";
import { eq, and } from "drizzle-orm";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

const CLINIC_ID = "2b0028b1-6bf3-42d7-852e-62a8b5ca1035";

type RawAppointment = {
  professional: "Natália Costa" | "Daniela";
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  clientName: string;
  serviceNames: string[]; // nomes exatamente como no print (mapeados abaixo)
};

const RAW_APPOINTMENTS: RawAppointment[] = [
  { professional: "Natália Costa", date: "2026-07-15", startTime: "13:00", endTime: "14:30", clientName: "Patricia Pontes", serviceNames: ["Manutenção 16 a 21 dias"] },
  { professional: "Natália Costa", date: "2026-07-15", startTime: "14:30", endTime: "16:30", clientName: "Nanda", serviceNames: ["Manutenção até 15 dias", "Designer de Sobrancelha"] },
  { professional: "Natália Costa", date: "2026-07-15", startTime: "16:30", endTime: "19:00", clientName: "Ana Luísa", serviceNames: ["Extensão de Cílios Gringa", "Designer de Sobrancelha"] },
  { professional: "Natália Costa", date: "2026-07-17", startTime: "13:00", endTime: "14:30", clientName: "Telma", serviceNames: ["Manutenção 16 a 21 dias"] },
  { professional: "Natália Costa", date: "2026-07-17", startTime: "14:30", endTime: "16:00", clientName: "Flavia Migles", serviceNames: ["Manutenção 16 a 21 dias"] },
  { professional: "Natália Costa", date: "2026-07-17", startTime: "18:00", endTime: "21:00", clientName: "Jessica Mendes", serviceNames: ["Manutenção Gringa", "Limpeza de Pele"] },
  { professional: "Natália Costa", date: "2026-07-18", startTime: "10:30", endTime: "12:00", clientName: "Angélica", serviceNames: ["Manutenção até 15 dias"] },
  { professional: "Natália Costa", date: "2026-07-18", startTime: "12:00", endTime: "12:30", clientName: "Denise Andrade", serviceNames: ["Designer de Sobrancelha"] },
  { professional: "Natália Costa", date: "2026-07-18", startTime: "13:30", endTime: "15:30", clientName: "Vanderleia", serviceNames: ["Extensão de Cilios Comum"] },
  { professional: "Natália Costa", date: "2026-07-20", startTime: "10:00", endTime: "11:30", clientName: "Aline Morais", serviceNames: ["Manutenção 16 a 21 dias"] },
  { professional: "Natália Costa", date: "2026-07-20", startTime: "14:00", endTime: "15:30", clientName: "Raquel Araujo", serviceNames: ["Manutenção Gringa"] },
  { professional: "Natália Costa", date: "2026-07-22", startTime: "13:00", endTime: "14:30", clientName: "Lilian Crispim Blank", serviceNames: ["Limpeza de Pele"] },
  { professional: "Natália Costa", date: "2026-07-22", startTime: "14:30", endTime: "16:00", clientName: "Lilian Crispim Blank", serviceNames: ["Extensão de Cílios Gringa"] },
  { professional: "Natália Costa", date: "2026-07-22", startTime: "16:00", endTime: "17:30", clientName: "Patrícia Nails Designer", serviceNames: ["Cortesia"] },
  { professional: "Natália Costa", date: "2026-07-25", startTime: "14:00", endTime: "15:30", clientName: "Giulia Péccora", serviceNames: ["Manutenção Gringa"] },
  { professional: "Natália Costa", date: "2026-07-25", startTime: "15:30", endTime: "17:00", clientName: "Priscila Sena", serviceNames: ["Manutenção 16 a 21 dias"] },
  { professional: "Natália Costa", date: "2026-07-29", startTime: "13:00", endTime: "14:30", clientName: "Catherine", serviceNames: ["Manutenção Gringa"] },
  { professional: "Natália Costa", date: "2026-07-29", startTime: "14:30", endTime: "16:00", clientName: "Patricia", serviceNames: ["Manutenção 16 a 21 dias"] },
  { professional: "Natália Costa", date: "2026-07-29", startTime: "18:00", endTime: "19:30", clientName: "Emilly", serviceNames: ["Manutenção até 15 dias"] },
  { professional: "Natália Costa", date: "2026-07-31", startTime: "13:00", endTime: "14:30", clientName: "Eliana Pacheco", serviceNames: ["Manutenção 16 a 21 dias"] },
  { professional: "Daniela", date: "2026-07-30", startTime: "16:30", endTime: "19:00", clientName: "Regina", serviceNames: ["Manutenção 16 a 21 dias"] },
];

// Nome no print → nome exato cadastrado em TREATMENTS (seed-nc-beauty-config.ts).
// "Cortesia" não é um treatment do catálogo (atendimento de brinde) — fica sem match.
const SERVICE_NAME_MAP: Record<string, string> = {
  "Manutenção 16 a 21 dias": "Manutenção de cílios (16 a 21 dias)",
  "Manutenção até 15 dias": "Manutenção de cílios (até 15 dias)",
  "Manutenção Gringa": "Manutenção de cílios — técnicas gringas",
  "Designer de Sobrancelha": "Designer de Sobrancelha",
  "Extensão de Cílios Gringa": "Extensão de cílios — Técnicas Gringas",
  "Extensão de Cilios Comum": "Extensão de cílios — Técnicas Comuns",
  "Limpeza de Pele": "Limpeza de Pele",
};

function normalizeWord(word: string): string {
  return word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

async function main() {
  console.log("🚀 NC Beauty — import de agendamentos reais transcritos de prints (15–31/07/2026)\n");

  const [clinicRow] = await db.select().from(organizations).where(eq(organizations.id, CLINIC_ID)).limit(1);
  if (!clinicRow) throw new Error("Clínica NC Beauty não encontrada");
  const timezone = new ClinicTimezone(clinicRow.timezone);

  const clinicProfessionals = await db.query.professionals.findMany({
    where: eq(professionals.clinicId, CLINIC_ID),
    columns: { id: true, name: true },
  });
  const professionalByName = new Map(clinicProfessionals.map((p) => [p.name, p.id]));

  const clinicTreatments = await db.query.treatments.findMany({
    where: eq(treatments.clinicId, CLINIC_ID),
    columns: { id: true, name: true, priceCents: true },
  });
  const treatmentByName = new Map(clinicTreatments.map((t) => [t.name, t]));

  const existingLeads = await db.query.leads.findMany({
    where: eq(leads.clinicId, CLINIC_ID),
    columns: { id: true, name: true },
  });
  const leadByNormalizedName = new Map(
    existingLeads.filter((l) => l.name).map((l) => [normalizeWord(l.name as string), l.id]),
  );

  let imported = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const raw of RAW_APPOINTMENTS) {
    const professionalId = professionalByName.get(raw.professional);
    if (!professionalId) {
      warnings.push(`Profissional não encontrada: "${raw.professional}" (${raw.clientName} em ${raw.date})`);
      continue;
    }

    const [year, month, day] = raw.date.split("-").map(Number);
    const [startHour, startMinute] = raw.startTime.split(":").map(Number);
    const [endHour, endMinute] = raw.endTime.split(":").map(Number);
    const startsAt = timezone.fromLocalParts(year, month - 1, day, startHour, startMinute);
    const endsAt = timezone.fromLocalParts(year, month - 1, day, endHour, endMinute);

    // Idempotência: um id sintético estável evita duplicar se o script rodar de novo.
    const calendarEventId = `manual-screenshot-nc-beauty-${raw.date}-${raw.startTime}-${normalizeWord(raw.clientName).replace(/\s+/g, "-")}`;
    const existingAppointment = await db.query.appointments.findFirst({
      where: and(eq(appointments.clinicId, CLINIC_ID), eq(appointments.calendarEventId, calendarEventId)),
      columns: { id: true },
    });
    if (existingAppointment) {
      skipped++;
      continue;
    }

    const matchedTreatments = raw.serviceNames
      .map((s) => treatmentByName.get(SERVICE_NAME_MAP[s] ?? s))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
    for (const s of raw.serviceNames) {
      if (!SERVICE_NAME_MAP[s] && s !== "Cortesia") {
        warnings.push(`Serviço sem mapeamento: "${s}" (${raw.clientName} em ${raw.date})`);
      }
    }
    const description = raw.serviceNames.join(" + ");
    const valueCents = matchedTreatments.length > 0
      ? matchedTreatments.reduce((sum, t) => sum + (t.priceCents ?? 0), 0)
      : null;

    const normalizedName = normalizeWord(raw.clientName);
    let leadId = leadByNormalizedName.get(normalizedName);
    if (!leadId) {
      const [newLead] = await db.insert(leads).values({
        clinicId: CLINIC_ID,
        name: raw.clientName,
        phone: null,
        email: null,
        channel: "manual",
        temperature: "warm",
        status: "appointment_scheduled",
      }).returning({ id: leads.id });
      leadId = newLead.id;
      leadByNormalizedName.set(normalizedName, leadId);
    }

    await db.insert(appointments).values({
      clinicId: CLINIC_ID,
      leadId,
      professionalId,
      startsAt,
      endsAt,
      status: "scheduled",
      source: "app",
      treatmentId: matchedTreatments[0]?.id ?? null,
      valueCents,
      description,
      calendarEventId,
    });
    imported++;
  }

  console.log(`✅ ${imported} agendamentos importados, ${skipped} já existiam (idempotente)`);
  if (warnings.length > 0) {
    console.log(`⚠️  Avisos:\n${warnings.map((w) => `   - ${w}`).join("\n")}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Erro:", err);
    process.exit(1);
  });
