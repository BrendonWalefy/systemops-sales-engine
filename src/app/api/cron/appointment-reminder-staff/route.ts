import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { db } from "@/infrastructure/db/client";
import { appointments, organizations, leads } from "@/infrastructure/db/schema";
import { listAllClinicIds } from "@/application/tenancy/resolve-clinic";
import { NotifyClinicOperators } from "@/application/use-cases/notifications/notify-clinic-operators";
import { DrizzlePushSubscriptionRepository } from "@/infrastructure/repositories/drizzle-push-subscription-repository";
import { WebPushGateway } from "@/infrastructure/adapters/push/web-push-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import {
  getStaffReminderWindows,
  isPendingCompletionAppointment,
} from "@/core/scheduling/appointment-reminder-staff";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { sendTextMessage, sendButtonListMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import {
  buildAppointmentCompletionButtons,
  buildPendingConfirmationMessage,
  buildTomorrowAgendaMessage,
} from "@/application/conversations/appointment-completion-review";

export const dynamic = "force-dynamic";

const notifier = new NotifyClinicOperators(
  new DrizzlePushSubscriptionRepository(),
  new WebPushGateway(),
);

type ClinicResult = { tomorrowCount: number; pendingCount: number };

async function processClinic(clinicId: string): Promise<ClinicResult> {
  const [clinic] = await db
    .select({
      timezone: organizations.timezone,
      name: organizations.name,
      receptionistPhone: organizations.receptionistPhone,
      staffDigestWhatsAppEnabled: organizations.staffDigestWhatsAppEnabled,
      channelProvider: organizations.channelProvider,
      zapiInstanceId: organizations.zapiInstanceId,
      zapiToken: organizations.zapiToken,
      zapiClientToken: organizations.zapiClientToken,
      metaPhoneNumberId: organizations.metaPhoneNumberId,
      metaAccessToken: organizations.metaAccessToken,
    })
    .from(organizations)
    .where(eq(organizations.id, clinicId))
    .limit(1);

  if (!clinic) return { tomorrowCount: 0, pendingCount: 0 };

  const tz = clinic.timezone ?? "America/Sao_Paulo";
  const timezone = new ClinicTimezone(tz);
  const now = new Date();
  const { startOfToday, startOfTomorrow, startOfDayAfterTomorrow } =
    getStaffReminderWindows(timezone, now);

  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Espelha os mesmos alertas no WhatsApp pessoal do responsável (receptionist_phone),
  // além do push — é o canal que o doutor realmente acompanha (pedido Vitalli 17/07).

  // ── Alerta 1: Agenda de amanhã ──
  const tomorrowAppts = await db
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      leadName: leads.name,
      leadPhone: leads.phone,
    })
    .from(appointments)
    .leftJoin(leads, eq(appointments.leadId, leads.id))
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        inArray(appointments.status, ["scheduled", "confirmed"]),
        gte(appointments.startsAt, startOfTomorrow),
        lt(appointments.startsAt, startOfDayAfterTomorrow),
      ),
    )
    .orderBy(appointments.startsAt);

  if (tomorrowAppts.length > 0) {
    const lines = tomorrowAppts
      .map((a) => `• ${fmt.format(a.startsAt)} — ${a.leadName ?? a.leadPhone ?? "Paciente"}`)
      .join("\n");

    await notifier.execute(clinicId, {
      title: `📅 Agenda de amanhã · ${clinic.name}`,
      body: `${tomorrowAppts.length} atendimento${tomorrowAppts.length !== 1 ? "s" : ""} agendado${tomorrowAppts.length !== 1 ? "s" : ""}:\n${lines}`,
      url: "/app/agenda",
    });


    console.log(`[AppointmentReminderStaff] clinic=${clinicId} amanhã=${tomorrowAppts.length}`);
  }

  // ── Alerta 2: Atendimentos de hoje sem confirmação de conclusão (Camada 2) ──
  // Consultas que já terminaram mas ainda estão em scheduled/confirmed (doutor não marcou como concluído)
  const pendingAppts = await db
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      leadName: leads.name,
      leadPhone: leads.phone,
    })
    .from(appointments)
    .leftJoin(leads, eq(appointments.leadId, leads.id))
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        inArray(appointments.status, ["scheduled", "confirmed"]),
        gte(appointments.startsAt, startOfToday),
        lt(appointments.startsAt, startOfTomorrow),
      ),
    )
    .orderBy(appointments.startsAt)
    .then((rows) => rows.filter((appointment) => isPendingCompletionAppointment(appointment, now)));

  if (pendingAppts.length > 0) {
    const lines = pendingAppts
      .map((a) => `• ${fmt.format(a.startsAt)} — ${a.leadName ?? a.leadPhone ?? "Paciente"}`)
      .join("\n");

    await notifier.execute(clinicId, {
      title: `⏳ Pendente de confirmação · ${clinic.name}`,
      body: `${pendingAppts.length} atendimento${pendingAppts.length !== 1 ? "s" : ""} de hoje sem conclusão registrada:\n${lines}`,
      url: "/app/agenda",
    });


    console.log(`[AppointmentReminderStaff] clinic=${clinicId} pendentes=${pendingAppts.length}`);
  }

  // ── WhatsApp do responsável (opt-in por clínica) ──
  //
  // DUAS mensagens, de propósito. A agenda de amanhã é informação: ele lê e
  // segue. A confirmação é ação pendente e precisa ser a última do chat, que é
  // onde ele olha. Juntas, a ação ficava enterrada sob uma lista já lida — e
  // consulta que não vira `completed` trava a regra de feedback e o faturamento
  // realizado do painel.
  if (clinic.staffDigestWhatsAppEnabled && clinic.receptionistPhone) {
    const channelConfig = resolveChannelConfig(clinic);
    const hasChannel =
      channelConfig.provider === "z_api" ? !!channelConfig.zapi : !!channelConfig.meta;

    if (hasChannel) {
      const agendaMessage = buildTomorrowAgendaMessage({
        clinicName: clinic.name,
        tomorrow: tomorrowAppts.map((a) => ({
          time: fmt.format(a.startsAt),
          leadName: a.leadName ?? a.leadPhone ?? "Paciente",
        })),
      });
      if (agendaMessage) {
        await sendTextMessage(clinic.receptionistPhone, agendaMessage, channelConfig)
          .catch((err) => console.error(`[AppointmentReminderStaff] agenda falhou clinic=${clinicId}:`, err));
      }

      const pendingForConfirmation = pendingAppts.map((a) => ({
        id: a.id,
        time: fmt.format(a.startsAt),
        leadName: a.leadName ?? a.leadPhone ?? "Paciente",
      }));
      const confirmationMessage = buildPendingConfirmationMessage({ pending: pendingForConfirmation });
      if (confirmationMessage) {
        // Botões primeiro; texto puro só se a camada interativa falhar — o mesmo
        // conteúdo já traz os códigos, então confirmar continua possível.
        try {
          await sendButtonListMessage(
            clinic.receptionistPhone,
            confirmationMessage,
            buildAppointmentCompletionButtons(pendingForConfirmation),
            channelConfig,
          );
        } catch (err) {
          console.warn(`[AppointmentReminderStaff] botões falharam clinic=${clinicId}; caindo para texto:`, err);
          await sendTextMessage(clinic.receptionistPhone, confirmationMessage, channelConfig)
            .catch((textErr) => console.error(`[AppointmentReminderStaff] confirmação falhou clinic=${clinicId}:`, textErr));
        }
      }
      console.log(`[AppointmentReminderStaff] clinic=${clinicId} whatsapp=ok`);
    }
  }

  return { tomorrowCount: tomorrowAppts.length, pendingCount: pendingAppts.length };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const clinicIds = await listAllClinicIds();
  const results = await Promise.allSettled(clinicIds.map((id) => processClinic(id)));

  let totalTomorrow = 0;
  let totalPending = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      totalTomorrow += r.value.tomorrowCount;
      totalPending += r.value.pendingCount;
    } else {
      console.error("[AppointmentReminderStaff] processClinic failed:", r.reason);
    }
  }

  return NextResponse.json({ clinics: clinicIds.length, totalTomorrow, totalPending });
}
