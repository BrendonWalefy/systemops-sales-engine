"use client";
import { BookOpen } from "lucide-react";
import type { Treatment } from "@/domain/entities/treatment";
import { TreatmentRow } from "../tratamentos/TreatmentRow";
import { AddTreatmentForm } from "../tratamentos/AddTreatmentForm";
import { S, SettingsCard, SettingsSection } from "./settings-primitives";

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
            <div style={{ padding: "20px 18px", textAlign: "center", color: S.textSec, fontSize: "14px" }}>
              Nenhum {serviceNoun} cadastrado ainda
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

          {/* Add treatment inline */}
          <div style={{ borderTop: `1px solid ${S.border}`, padding: "0 18px 4px" }}>
            <AddTreatmentForm canEditPrices={canEditPrices} serviceNoun={serviceNoun} />
          </div>
        </SettingsCard>
      </SettingsSection>

    </div>
  );
}
