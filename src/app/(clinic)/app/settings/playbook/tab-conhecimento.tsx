"use client";
import { Clock, BookOpen, HelpCircle, AlertTriangle } from "lucide-react";
import type { Treatment } from "@/domain/entities/treatment";
import { TreatmentRow } from "../tratamentos/TreatmentRow";
import { AddTreatmentForm } from "../tratamentos/AddTreatmentForm";
import { S, SettingsCard, SettingsSection, EmptyState } from "./settings-primitives";

export function TabConhecimento({
  treatments,
  canEditPrices,
  serviceNoun,
}: {
  treatments: Treatment[];
  canEditPrices: boolean;
  serviceNoun: string;
}) {
  const serviceNounCapitalized = serviceNoun.charAt(0).toUpperCase() + serviceNoun.slice(1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: S.sectionGap, maxWidth: "720px" }}>

      {/* Serviços */}
      <SettingsSection
        title={`${serviceNounCapitalized}s e serviços`}
        description="A IA reconhece esses procedimentos e reserva o tempo exato no calendário"
      >
        <SettingsCard style={{ padding: 0, overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 18px", borderBottom: `1px solid ${S.border}` }}>
            <div style={{ width: "34px", height: "34px", borderRadius: "8px", border: `1px solid rgba(0,224,178,0.15)`, background: "rgba(0,224,178,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: S.teal }}>
              <BookOpen size={15} strokeWidth={1.8} />
            </div>
            <div>
              <strong style={{ fontSize: S.fs.title, fontWeight: 600, color: S.text }}>
                {treatments.length === 0
                  ? `Nenhum ${serviceNoun} cadastrado`
                  : `${treatments.length} ${serviceNoun}${treatments.length !== 1 ? "s" : ""} cadastrado${treatments.length !== 1 ? "s" : ""}`}
              </strong>
              <p style={{ margin: "2px 0 0", fontSize: S.fs.desc, color: S.textSec }}>
                Nome e duração · edite e salve inline
              </p>
            </div>
          </div>

          {/* Treatment list */}
          {treatments.length === 0 ? (
            <div style={{ padding: "24px 18px", textAlign: "center", color: S.textSec, fontSize: "14px" }}>
              Adicione o primeiro {serviceNoun} abaixo
            </div>
          ) : (
            <div>
              {treatments.map((t, idx) => (
                <TreatmentRow
                  key={t.id}
                  treatment={t}
                  isLast={idx === treatments.length - 1}
                  canEditPrices={canEditPrices}
                  serviceNoun={serviceNoun}
                  mode="info"
                />
              ))}
            </div>
          )}
        </SettingsCard>

        <SettingsCard style={{ padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
            <Clock size={13} style={{ color: S.textMuted }} />
            <p style={{ margin: 0, fontSize: "12px", color: S.textSec }}>
              Procedimentos sem duração cadastrada usarão o intervalo padrão de agendamento.
            </p>
          </div>
          <AddTreatmentForm canEditPrices={canEditPrices} serviceNoun={serviceNoun} />
        </SettingsCard>
      </SettingsSection>

      {/* Dados da clínica — scaffolding */}
      <SettingsSection title="Dados da clínica" description="Informações que a IA usa para responder sobre localização e contato">
        <SettingsCard>
          <EmptyState
            icon={<BookOpen size={16} />}
            title="Em breve"
            description="Endereço, telefone, links e informações gerais da clínica"
          />
        </SettingsCard>
      </SettingsSection>

      {/* Perguntas frequentes — scaffolding */}
      <SettingsSection title="Perguntas frequentes" description="Respostas padrão que a IA deve seguir">
        <SettingsCard>
          <EmptyState
            icon={<HelpCircle size={16} />}
            title="Em breve"
            description="Configure respostas para dúvidas comuns sobre a clínica, procedimentos e agendamento"
          />
        </SettingsCard>
      </SettingsSection>

      {/* Limites da IA — scaffolding */}
      <SettingsSection title="Limites da IA" description="O que a IA não deve prometer ou responder">
        <SettingsCard>
          <EmptyState
            icon={<AlertTriangle size={16} />}
            title="Em breve"
            description="Defina o que a IA pode e não pode informar — quando chamar um humano, o que não prometer"
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
