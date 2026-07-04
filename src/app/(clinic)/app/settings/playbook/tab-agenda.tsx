"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { Timer } from "lucide-react";
import { updateClinicOperationalSettings } from "./playbook-version-actions";
import { S, SettingsCard, SettingsSection, SaveStatus, SettingsInput } from "./settings-primitives";
import { useReliableAutosave } from "./use-reliable-autosave";

export type SettingsFocusTarget = "takeover" | "buffer" | "hours";

type ClinicData = {
  businessHours: string | null;
  receptionistPhone: string | null;
  takeoverTtlHours: number | null;
  postAppointmentBufferMinutes: number | null;
  staleConversationHours: number | null;
  slotLookaheadDays: number | null;
  mediaTakeoverTtlHours: number | null;
};

const labelStyle = {
  margin: "0 0 6px",
  fontSize: S.fs.label,
  fontWeight: 600 as const,
  color: S.textMuted,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

function NumericRow({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  last,
  inputRef,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit: string;
  last?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        padding: "12px 18px",
        borderBottom: last ? "none" : `1px solid ${S.border}`,
      }}
    >
      <p style={{ margin: 0, fontSize: "13px", fontWeight: 500, color: S.text }}>{label}</p>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={(e) => onChange(parseInt(e.target.value) || min)}
          style={{
            width: "48px",
            height: "30px",
            background: "rgba(0,224,178,0.08)",
            border: "1px solid rgba(0,224,178,0.15)",
            borderRadius: "8px",
            color: S.teal,
            fontWeight: 700,
            fontSize: "13px",
            padding: "0 6px",
            outline: "none",
            textAlign: "center",
            fontFamily: "inherit",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = S.borderActive;
            e.currentTarget.style.boxShadow = `0 0 0 3px rgba(0,224,178,0.1)`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "rgba(0,224,178,0.15)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        <span style={{ fontSize: "11px", color: S.textMuted, whiteSpace: "nowrap", minWidth: "24px" }}>{unit}</span>
      </div>
    </div>
  );
}

export function TabAgenda({ clinic, focusTarget, onFocusHandled }: {
  clinic: ClinicData;
  focusTarget: SettingsFocusTarget | null;
  onFocusHandled: () => void;
}) {
  const [businessHours, setBusinessHours] = useState(clinic.businessHours ?? "");
  const [receptionistPhone, setReceptionistPhone] = useState(clinic.receptionistPhone ?? "");
  const [takeoverTtlHours, setTakeoverTtlHours] = useState(clinic.takeoverTtlHours ?? 4);
  const [postAppointmentBufferMinutes, setPostAppointmentBufferMinutes] = useState(clinic.postAppointmentBufferMinutes ?? 60);
  const [staleConversationHours, setStaleConversationHours] = useState(clinic.staleConversationHours ?? 4);
  const [slotLookaheadDays, setSlotLookaheadDays] = useState(clinic.slotLookaheadDays ?? 14);
  const [mediaTakeoverTtlHours, setMediaTakeoverTtlHours] = useState(clinic.mediaTakeoverTtlHours ?? 0);
  const { scheduleSave, saving, saved, pending, error } = useReliableAutosave<{
    businessHours: string | null;
    receptionistPhone: string | null;
    takeoverTtlHours: number;
    postAppointmentBufferMinutes: number;
    staleConversationHours: number;
    slotLookaheadDays: number;
    mediaTakeoverTtlHours: number | null;
  }>({
    delayMs: 1000,
    save: updateClinicOperationalSettings,
  });

  const businessHoursSectionRef = useRef<HTMLDivElement>(null);
  const takeoverSectionRef = useRef<HTMLDivElement>(null);
  const bufferSectionRef = useRef<HTMLDivElement>(null);
  const businessHoursInputRef = useRef<HTMLInputElement>(null);
  const takeoverInputRef = useRef<HTMLInputElement | null>(null);
  const bufferInputRef = useRef<HTMLInputElement | null>(null);

  const triggerSave = useCallback((patch: {
    businessHours?: string;
    receptionistPhone?: string;
    takeoverTtlHours?: number;
    postAppointmentBufferMinutes?: number;
    staleConversationHours?: number;
    slotLookaheadDays?: number;
    mediaTakeoverTtlHours?: number;
  }) => {
    scheduleSave({
      businessHours: (patch.businessHours ?? businessHours) || null,
      receptionistPhone: (patch.receptionistPhone ?? receptionistPhone) || null,
      takeoverTtlHours: patch.takeoverTtlHours ?? takeoverTtlHours,
      postAppointmentBufferMinutes: patch.postAppointmentBufferMinutes ?? postAppointmentBufferMinutes,
      staleConversationHours: patch.staleConversationHours ?? staleConversationHours,
      slotLookaheadDays: patch.slotLookaheadDays ?? slotLookaheadDays,
      mediaTakeoverTtlHours: (() => {
        const v = patch.mediaTakeoverTtlHours ?? mediaTakeoverTtlHours;
        return v > 0 ? v : null;
      })(),
    });
  }, [
    businessHours,
    receptionistPhone,
    takeoverTtlHours,
    postAppointmentBufferMinutes,
    staleConversationHours,
    slotLookaheadDays,
    mediaTakeoverTtlHours,
    scheduleSave,
  ]);

  useEffect(() => {
    if (!focusTarget) return;
    const targets = {
      hours: { section: businessHoursSectionRef.current, input: businessHoursInputRef.current },
      takeover: { section: takeoverSectionRef.current, input: takeoverInputRef.current },
      buffer: { section: bufferSectionRef.current, input: bufferInputRef.current },
    };
    const t = targets[focusTarget];
    if (!t) return;

    let focusTimeout: ReturnType<typeof setTimeout> | null = null;
    const scrollTimeout = setTimeout(() => {
      t.section?.scrollIntoView({ behavior: "smooth", block: "center" });
      focusTimeout = setTimeout(() => {
        t.input?.focus();
        onFocusHandled();
      }, 220);
    }, 50);

    return () => {
      clearTimeout(scrollTimeout);
      if (focusTimeout) clearTimeout(focusTimeout);
    };
  }, [focusTarget, onFocusHandled]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: S.sectionGap, maxWidth: "660px" }}>

      {/* Disponibilidade */}
      <SettingsSection title="Disponibilidade">
        <SettingsCard style={{ padding: 0, overflow: "hidden" }}>
          <div ref={businessHoursSectionRef} style={{ padding: "12px 18px", borderBottom: `1px solid ${S.border}` }}>
            <p style={labelStyle}>Horário de funcionamento</p>
            <SettingsInput
              ref={businessHoursInputRef}
              type="text"
              value={businessHours}
              onChange={(e) => { setBusinessHours(e.target.value); triggerSave({ businessHours: e.target.value }); }}
              placeholder="Ex: Seg–sex 8h–18h · Sáb 8h–13h"
              style={{ height: "36px", fontSize: "13px" }}
            />
          </div>
          <div style={{ padding: "12px 18px" }}>
            <p style={labelStyle}>Telefone da recepção</p>
            <SettingsInput
              type="tel"
              value={receptionistPhone}
              onChange={(e) => { setReceptionistPhone(e.target.value); triggerSave({ receptionistPhone: e.target.value }); }}
              placeholder="Ex: 11 99000-0000"
              style={{ height: "36px", fontSize: "13px" }}
            />
            <p style={{ margin: "5px 0 0", fontSize: "11px", color: S.textMuted }}>
              Recebe alertas quando a IA pede atenção humana
            </p>
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* Comportamento automático */}
      <div ref={takeoverSectionRef}>
        <SettingsSection title="Comportamento automático">
          <SettingsCard style={{ padding: 0, overflow: "hidden" }}>
            <div ref={bufferSectionRef}>
              <NumericRow
                label="Pausa automática"
                value={takeoverTtlHours}
                onChange={(v) => { setTakeoverTtlHours(v); triggerSave({ takeoverTtlHours: v }); }}
                min={0} max={72} unit="horas"
                inputRef={takeoverInputRef}
              />
              <NumericRow
                label="Intervalo entre atendimentos"
                value={postAppointmentBufferMinutes}
                onChange={(v) => { setPostAppointmentBufferMinutes(v); triggerSave({ postAppointmentBufferMinutes: v }); }}
                min={0} max={240} step={5} unit="min"
                inputRef={bufferInputRef}
              />
              <NumericRow
                label="Janela de agenda"
                value={slotLookaheadDays}
                onChange={(v) => { setSlotLookaheadDays(v); triggerSave({ slotLookaheadDays: v }); }}
                min={1} max={90} unit="dias"
              />
              <NumericRow
                label="Conversa parada"
                value={staleConversationHours}
                onChange={(v) => { setStaleConversationHours(v); triggerSave({ staleConversationHours: v }); }}
                min={1} max={72} unit="horas"
              />
              <NumericRow
                label="Retorno após mídia"
                value={mediaTakeoverTtlHours}
                onChange={(v) => { setMediaTakeoverTtlHours(v); triggerSave({ mediaTakeoverTtlHours: v }); }}
                min={0} max={72} unit="horas"
                last
              />
            </div>
          </SettingsCard>
        </SettingsSection>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <Timer size={13} style={{ color: S.textMuted }} />
        <SaveStatus saving={saving} saved={saved} pending={pending} error={error} />
      </div>
    </div>
  );
}
