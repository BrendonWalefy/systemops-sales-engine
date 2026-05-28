export const dynamic = "force-dynamic";

import { Clock, Plus, Stethoscope, Save, Trash2 } from "lucide-react";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import { createTreatment, deleteTreatment, updateTreatment } from "./actions";

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

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
                // Um único form por linha — Save usa action padrão, Remover usa formAction
                <form
                  key={t.id}
                  action={updateTreatment}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 110px auto auto",
                    alignItems: "center",
                    gap: "10px",
                    padding: "12px 22px",
                    borderBottom: idx < treatments.length - 1 ? "1px solid var(--line)" : undefined,
                  }}
                >
                  <input type="hidden" name="id" value={t.id} />
                  <input
                    type="text"
                    name="name"
                    defaultValue={t.name}
                    required
                    style={{ margin: 0, fontSize: "14px" }}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
                    <input
                      type="number"
                      name="durationMinutes"
                      defaultValue={t.durationMinutes}
                      min={5}
                      max={480}
                      step={5}
                      required
                      style={{ width: "60px", textAlign: "center", margin: 0, fontSize: "13px" }}
                    />
                    <span style={{ fontSize: "12px", color: "var(--muted)", whiteSpace: "nowrap" }}>
                      min · {formatDuration(t.durationMinutes)}
                    </span>
                  </label>
                  <button
                    type="submit"
                    className="primary-button"
                    style={{ padding: "7px 12px", gap: "6px", fontSize: "13px" }}
                  >
                    <Save size={13} strokeWidth={2} />
                    Salvar
                  </button>
                  {/* formAction envia o mesmo form para deleteTreatment — só lê o campo "id" */}
                  <button
                    type="submit"
                    formAction={deleteTreatment}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "7px 10px",
                      fontSize: "13px",
                      border: "1px solid var(--line)",
                      borderRadius: "8px",
                      background: "transparent",
                      color: "var(--muted)",
                      cursor: "pointer",
                    }}
                  >
                    <Trash2 size={13} strokeWidth={2} />
                  </button>
                </form>
              ))}
            </div>
          )}
        </section>

        {/* Adicionar novo procedimento */}
        <section
          style={{
            border: "1px solid var(--line)",
            borderRadius: "14px",
            background: "var(--surface-soft)",
            padding: "20px 22px",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "18px" }}>
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
            <div>
              <strong style={{ fontSize: "15px", fontWeight: 700, color: "var(--text)" }}>
                Adicionar procedimento
              </strong>
              <p style={{ margin: "3px 0 0", fontSize: "13px", color: "var(--muted)" }}>
                A IA reconhece variações de escrita e erros de digitação e bloqueia o tempo exato no calendário.
              </p>
            </div>
          </div>

          <form
            action={createTreatment}
            style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: "12px", alignItems: "end" }}
          >
            <label style={{ margin: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                <Stethoscope size={12} strokeWidth={2} style={{ color: "var(--muted)" }} />
                <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 500 }}>
                  Nome do procedimento
                </span>
              </span>
              <input
                type="text"
                name="name"
                placeholder="Ex: 20 Lentes"
                required
                style={{ margin: 0 }}
              />
            </label>

            <label style={{ margin: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                <Clock size={12} strokeWidth={2} style={{ color: "var(--muted)" }} />
                <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 500 }}>
                  Duração (min)
                </span>
              </span>
              <input
                type="number"
                name="durationMinutes"
                placeholder="60"
                min={5}
                max={480}
                step={5}
                required
                defaultValue={60}
                style={{ textAlign: "center", margin: 0 }}
              />
            </label>

            <button type="submit" className="primary-button" style={{ gap: "8px" }}>
              <Plus size={14} strokeWidth={2} />
              Adicionar
            </button>
          </form>
        </section>

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
