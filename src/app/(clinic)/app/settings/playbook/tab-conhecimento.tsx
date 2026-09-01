"use client";
import { useCallback, useState } from "react";
import { BookOpen, CarFront, Plus, Share2, Trash2 } from "lucide-react";
import type { SocialChannel } from "@/domain/entities/clinic";
import type { Treatment } from "@/domain/entities/treatment";
import { TreatmentRow } from "../tratamentos/TreatmentRow";
import { AddTreatmentForm } from "../tratamentos/AddTreatmentForm";
import { updateInstitutionalDetails } from "./playbook-version-actions";
import { useReliableAutosave } from "./use-reliable-autosave";
import {
  S,
  SaveStatus,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsTextarea,
} from "./settings-primitives";

type EditableSocialChannel = { label: string; url: string };

function editableChannels(channels: SocialChannel[] | null): EditableSocialChannel[] {
  return channels?.length
    ? channels.map((channel) => ({ ...channel }))
    : [{ label: "", url: "" }];
}

export function TabConhecimento({
  clinic,
  treatments,
  canEditPrices,
  serviceNoun,
}: {
  clinic: {
    parkingInformation: string | null;
    socialChannels: SocialChannel[] | null;
  };
  treatments: Treatment[];
  canEditPrices: boolean;
  serviceNoun: string;
}) {
  const serviceNounCapitalized = serviceNoun.charAt(0).toUpperCase() + serviceNoun.slice(1);
  const [parkingInformation, setParkingInformation] = useState(clinic.parkingInformation ?? "");
  const [socialChannels, setSocialChannels] = useState<EditableSocialChannel[]>(
    () => editableChannels(clinic.socialChannels),
  );
  const { scheduleSave, saving, saved, pending, error } = useReliableAutosave<{
    parkingInformation: string | null;
    socialChannels: EditableSocialChannel[] | null;
  }>({ delayMs: 1000, save: updateInstitutionalDetails });

  const persist = useCallback((
    nextParking: string,
    nextChannels: EditableSocialChannel[],
  ) => {
    scheduleSave({
      parkingInformation: nextParking || null,
      socialChannels: nextChannels,
    });
  }, [scheduleSave]);

  function updateChannel(index: number, patch: Partial<EditableSocialChannel>) {
    const next = socialChannels.map((channel, candidateIndex) =>
      candidateIndex === index ? { ...channel, ...patch } : channel
    );
    setSocialChannels(next);
    persist(parkingInformation, next);
  }

  function removeChannel(index: number) {
    const filtered = socialChannels.filter((_, candidateIndex) => candidateIndex !== index);
    const next = filtered.length > 0 ? filtered : [{ label: "", url: "" }];
    setSocialChannels(next);
    persist(parkingInformation, next);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: S.sectionGap, maxWidth: "720px" }}>

      <SettingsSection
        title="Informações institucionais"
        description="Fatos que a IA pode informar sem inventar ou consultar textos livres"
      >
        <SettingsCard>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "10px" }}>
            <CarFront size={16} color={S.teal} />
            <strong style={{ color: S.text, fontSize: S.fs.title }}>Estacionamento</strong>
          </div>
          <SettingsTextarea
            aria-label="Informações de estacionamento"
            value={parkingInformation}
            maxLength={240}
            rows={3}
            placeholder="Ex.: Há vagas conveniadas no prédio ao lado."
            onChange={(event) => {
              const next = event.target.value;
              setParkingInformation(next);
              persist(next, socialChannels);
            }}
          />

          <div style={{ borderTop: `1px solid ${S.border}`, margin: "18px 0" }} />

          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "10px" }}>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <Share2 size={16} color={S.teal} />
              <strong style={{ color: S.text, fontSize: S.fs.title }}>Redes e canais</strong>
            </div>
            <button
              type="button"
              disabled={socialChannels.length >= 5}
              onClick={() => setSocialChannels((current) => [...current, { label: "", url: "" }])}
              style={{ display: "flex", alignItems: "center", gap: "5px", border: `1px solid ${S.borderActive}`, borderRadius: "8px", background: S.cardActive, color: S.teal, padding: "7px 10px", cursor: socialChannels.length >= 5 ? "default" : "pointer", opacity: socialChannels.length >= 5 ? 0.5 : 1 }}
            >
              <Plus size={13} /> Adicionar
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {socialChannels.map((channel, index) => (
              <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(100px, 0.7fr) minmax(180px, 1.5fr) 34px", gap: "8px" }}>
                <SettingsInput
                  aria-label={`Nome do canal ${index + 1}`}
                  value={channel.label}
                  maxLength={40}
                  placeholder="Instagram"
                  onChange={(event) => updateChannel(index, { label: event.target.value })}
                />
                <SettingsInput
                  aria-label={`URL do canal ${index + 1}`}
                  type="url"
                  value={channel.url}
                  maxLength={240}
                  placeholder="https://..."
                  onChange={(event) => updateChannel(index, { url: event.target.value })}
                />
                <button
                  type="button"
                  aria-label={`Remover canal ${index + 1}`}
                  onClick={() => removeChannel(index)}
                  style={{ border: `1px solid ${S.border}`, borderRadius: "8px", background: S.card, color: S.textMuted, cursor: "pointer" }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </SettingsCard>
        <SaveStatus saving={saving} saved={saved} pending={pending} error={error} />
      </SettingsSection>

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
