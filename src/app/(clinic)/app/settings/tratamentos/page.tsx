export const dynamic = "force-dynamic";

import { Clock, Stethoscope } from "lucide-react";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import { TreatmentRow } from "./TreatmentRow";
import { AddTreatmentForm } from "./AddTreatmentForm";

export default async function TratamentosPage() {
  const clinicId = process.env.PILOT_CLINIC_ID!;
  const repo = new DrizzleTreatmentRepository();
  const treatments = await repo.listByClinic(clinicId);

  return (
    <div>
      <div className="product-topbar">
        <div>
          <p className="eyebrow">Configurações</p>
          <h1>Procedimentos</h1>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: "14px" }}>
            Gerencie os procedimentos oferecidos e suas durações. A IA identifica o procedimento durante
            a conversa e oferece horários compatíveis automaticamente.
          </p>
        </div>
      </div>

      <div className="page-content" style={{ paddingBottom: "40px", display: "grid", gap: "24px", maxWidth: "760px" }}>

        {/* Lista de procedimentos */}
        <section
          style={{
            border: "1px solid var(--line)",
            borderRadius: "14px",
            background: "var(--surface-soft)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
              padding: "18px 22px",
              borderBottom: "1px solid var(--line)",
            }}
          >
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
              <Stethoscope size={18} strokeWidth={1.8} />
            </div>
            <div>
              <strong style={{ fontSize: "15px", fontWeight: 700, color: "var(--text)" }}>
                Procedimentos cadastrados
              </strong>
              <p style={{ margin: "3px 0 0", fontSize: "13px", color: "var(--muted)" }}>
                {treatments.length === 0
                  ? "Nenhum procedimento cadastrado ainda"
                  : `${treatments.length} procedimento${treatments.length !== 1 ? "s" : ""} · edite e salve inline`}
              </p>
            </div>
          </div>

          {treatments.length === 0 ? (
            <div style={{ padding: "32px 22px", textAlign: "center", color: "var(--muted)", fontSize: "14px" }}>
              Adicione o primeiro procedimento abaixo
            </div>
          ) : (
            <div style={{ display: "grid" }}>
              {treatments.map((t, idx) => (
                <TreatmentRow key={t.id} treatment={t} isLast={idx === treatments.length - 1} />
              ))}
            </div>
          )}
        </section>

        <AddTreatmentForm />

        {/* Info sobre duração padrão */}
        <div className="automation-note">
          <div className="automation-header">
            <Clock size={14} strokeWidth={2} />
            <strong style={{ fontSize: "12.5px", fontWeight: 700 }}>Duração padrão</strong>
          </div>
          <p>
            Quando o lead não especificar um procedimento ou for o primeiro contato, a IA usará a duração
            padrão configurada em Agendamento. Procedimentos cadastrados aqui têm prioridade sobre o padrão.
          </p>
        </div>

      </div>
    </div>
  );
}
