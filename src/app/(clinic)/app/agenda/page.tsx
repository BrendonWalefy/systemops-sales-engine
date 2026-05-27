export const dynamic = "force-dynamic";

import { Trash2, Plus, Clock } from "lucide-react";
import { BlockForm } from "./BlockForm";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import type { BlockEvent } from "@/application/ports/calendar-gateway";
import { deleteBlock } from "./actions";

const TZ = "America/Sao_Paulo";

function formatBlock(block: BlockEvent): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  const start = block.startsAt.toLocaleString("pt-BR", opts);
  const endTime = block.endsAt.toLocaleString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${start} – ${endTime}`;
}

async function getBlocks(): Promise<BlockEvent[]> {
  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) return [];

  const [clinic] = await db
    .select({ googleCalendarId: clinics.googleCalendarId, timezone: clinics.timezone, businessHours: clinics.businessHours })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  if (!clinic) return [];

  const gateway = new GoogleCalendarGateway(
    clinic.googleCalendarId,
    new ClinicTimezone(clinic.timezone),
    clinic.businessHours,
  );

  const from = new Date();
  const to = new Date(Date.now() + 60 * 24 * 60 * 60_000);

  return gateway.listBlockEvents({ clinicId, from, to });
}

export default async function AgendaPage() {
  const blocks = await getBlocks();

  return (
    <div>
      <div className="product-topbar">
        <div>
          <p className="eyebrow">Agenda</p>
          <h1>Gerenciar Bloqueios</h1>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: "14px" }}>
            Bloqueios impedem a IA de oferecer esses horários automaticamente.
          </p>
        </div>
      </div>

      <div className="agenda-content">

        {/* Formulário de novo bloqueio */}
        <section
          style={{
            border: "1px solid var(--line)",
            borderRadius: "14px",
            background: "var(--surface-soft)",
            padding: "20px 22px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "18px" }}>
            <div
              style={{
                display: "grid",
                placeItems: "center",
                width: "40px",
                height: "40px",
                flexShrink: 0,
                borderRadius: "10px",
                border: "1px solid var(--line)",
                background: "var(--surface-raised)",
                color: "var(--accent-strong)",
              }}
            >
              <Plus size={18} strokeWidth={1.8} />
            </div>
            <strong style={{ fontSize: "15px", fontWeight: 700, color: "var(--text)" }}>
              Novo bloqueio
            </strong>
          </div>

          <BlockForm />
        </section>

        {/* Lista de bloqueios */}
        <section
          style={{
            border: "1px solid var(--line)",
            borderRadius: "14px",
            background: "var(--surface-soft)",
            padding: "20px 22px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "18px" }}>
            <div
              style={{
                display: "grid",
                placeItems: "center",
                width: "40px",
                height: "40px",
                flexShrink: 0,
                borderRadius: "10px",
                border: "1px solid var(--line)",
                background: "var(--surface-raised)",
                color: "var(--accent-strong)",
              }}
            >
              <Clock size={18} strokeWidth={1.8} />
            </div>
            <div>
              <strong style={{ fontSize: "15px", fontWeight: 700, color: "var(--text)" }}>
                Próximos 60 dias
              </strong>
              <p style={{ margin: "2px 0 0", fontSize: "13px", color: "var(--muted)" }}>
                {blocks.length === 0 ? "Nenhum bloqueio cadastrado" : `${blocks.length} bloqueio${blocks.length !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>

          {blocks.length === 0 ? (
            <p style={{ fontSize: "14px", color: "var(--muted)", margin: 0, paddingLeft: "54px" }}>
              Adicione bloqueios para períodos em que o doutor estará indisponível.
            </p>
          ) : (
            <div style={{ display: "grid", gap: "8px" }}>
              {blocks.map((block) => (
                <div
                  key={block.calendarEventId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 14px",
                    background: "var(--surface-raised)",
                    border: "1px solid var(--line)",
                    borderRadius: "10px",
                    gap: "12px",
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>
                      {formatBlock(block)}
                    </p>
                    {block.reason && (
                      <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--muted)" }}>
                        {block.reason}
                      </p>
                    )}
                  </div>
                  <form action={deleteBlock.bind(null, block.calendarEventId)}>
                    <button
                      type="submit"
                      title="Remover bloqueio"
                      style={{
                        background: "none",
                        border: "1px solid var(--line)",
                        borderRadius: "8px",
                        padding: "7px 9px",
                        cursor: "pointer",
                        color: "var(--muted)",
                        display: "flex",
                        alignItems: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Trash2 size={14} strokeWidth={1.8} />
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
