export const dynamic = "force-dynamic";

import { BookText, Clock, MessageSquare, Save, Timer } from "lucide-react";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { ToggleAutoReply } from "./toggle-auto-reply";
import { savePlaybook, saveTakeoverTtl } from "./actions";

async function getClinic() {
  const clinicId = process.env.PILOT_CLINIC_ID!;
  const result = await db
    .select({
      id: clinics.id,
      name: clinics.name,
      toneOfVoice: clinics.toneOfVoice,
      businessHours: clinics.businessHours,
      commercialPolicy: clinics.commercialPolicy,
      playbook: clinics.playbook,
      autoReplyEnabled: clinics.autoReplyEnabled,
      takeoverTtlHours: clinics.takeoverTtlHours,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  return result[0] ?? null;
}

export default async function PlaybookPage() {
  const clinic = await getClinic();

  return (
    <div>
      <div className="product-topbar">
        <div>
          <p className="eyebrow">Configurações</p>
          <h1>Configurações da IA</h1>
          {clinic && (
            <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: "14px" }}>
              {clinic.name}
            </p>
          )}
        </div>
      </div>

      <div className="page-content" style={{ paddingBottom: "40px", display: "grid", gap: "24px", maxWidth: "760px" }}>
        <section
          style={{
            border: "1px solid var(--line)",
            borderRadius: "14px",
            background: "var(--surface-soft)",
            padding: "20px 22px",
          }}
        >
          <div className="ia-section-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
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
                <MessageSquare size={18} strokeWidth={1.8} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                  <strong style={{ fontSize: "15px", fontWeight: 700, color: "var(--text)" }}>
                    Recepcionista IA
                  </strong>
                  {clinic?.autoReplyEnabled ? (
                    <span className="status-pill" style={{ fontSize: "11px", padding: "3px 10px" }}>
                      <span className="status-dot" />
                      Ativo
                    </span>
                  ) : (
                    <span className="status-pill status-handoff" style={{ fontSize: "11px", padding: "3px 10px" }}>
                      <span className="status-dot" />
                      Pausado
                    </span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)", lineHeight: 1.5 }}>
                  Quando ativado, a IA responde automaticamente leads no WhatsApp
                </p>
              </div>
            </div>
            <ToggleAutoReply enabled={clinic?.autoReplyEnabled ?? false} />
          </div>
        </section>

        <section
          style={{
            border: "1px solid var(--line)",
            borderRadius: "14px",
            background: "var(--surface-soft)",
            padding: "20px 22px",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "16px" }}>
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
              <Timer size={18} strokeWidth={1.8} />
            </div>
            <div>
              <strong style={{ fontSize: "15px", fontWeight: 700, color: "var(--text)" }}>
                Pausa automática da IA
              </strong>
              <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--muted)", lineHeight: 1.5 }}>
                Após o operador responder, a IA retoma automaticamente depois deste período. Use 0 para desativar a retomada automática.
              </p>
            </div>
          </div>
          <form action={saveTakeoverTtl} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
              <input
                type="number"
                name="takeoverTtlHours"
                defaultValue={clinic?.takeoverTtlHours ?? 4}
                min={0}
                max={72}
                style={{ width: "80px", textAlign: "center" }}
              />
              <span style={{ fontSize: "13px", color: "var(--muted)" }}>horas</span>
            </label>
            <button type="submit" className="primary-button" style={{ gap: "8px" }}>
              <Save size={14} strokeWidth={2} />
              Salvar
            </button>
          </form>
        </section>

        <form action={savePlaybook}>
          <div className="form-stack">
            <p className="small-label" style={{ marginBottom: "4px" }}>Comportamento da IA</p>

            <label>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Clock size={13} strokeWidth={2} style={{ color: "var(--muted)" }} />
                Tom de voz
              </span>
              <input
                type="text"
                name="toneOfVoice"
                defaultValue={clinic?.toneOfVoice ?? ""}
                placeholder="Ex: Acolhedor, profissional e direto"
              />
            </label>

            <label>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Clock size={13} strokeWidth={2} style={{ color: "var(--muted)" }} />
                Horário de funcionamento
              </span>
              <input
                type="text"
                name="businessHours"
                defaultValue={clinic?.businessHours ?? ""}
                placeholder="Ex: Seg a Sex das 8h às 18h, Sáb das 8h às 12h"
              />
            </label>

            <label>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <MessageSquare size={13} strokeWidth={2} style={{ color: "var(--muted)" }} />
                Política comercial
              </span>
              <textarea
                name="commercialPolicy"
                rows={4}
                defaultValue={clinic?.commercialPolicy ?? ""}
                placeholder="Ex: Sempre oferecer avaliação gratuita. Não informar preços por mensagem."
              />
            </label>

            <label>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <BookText size={13} strokeWidth={2} style={{ color: "var(--muted)" }} />
                Playbook da IA
              </span>
              <textarea
                name="playbook"
                rows={10}
                defaultValue={clinic?.playbook ?? ""}
                placeholder="Instruções detalhadas para a IA seguir durante as conversas..."
              />
            </label>

            <div className="automation-note">
              <div className="automation-header">
                <BookText size={14} strokeWidth={2} />
                <strong style={{ fontSize: "12.5px", fontWeight: 700 }}>Como usar o Playbook</strong>
              </div>
              <p>
                O playbook define como a IA se comporta em cada situação. Seja específico: mencione
                procedimentos oferecidos, objeções comuns, tom esperado e o que fazer em cada etapa
                da conversa.
              </p>
            </div>

            <button
              type="submit"
              className="primary-button"
              style={{ gap: "8px", marginTop: "4px" }}
            >
              <Save size={15} strokeWidth={2} />
              Salvar configurações
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
