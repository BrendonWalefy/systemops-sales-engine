"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { Clock, Phone, Timer } from "lucide-react";
import { updateClinicOperationalSettings } from "./playbook-version-actions";
import { S, SettingsCard, SettingsSection, SaveStatus, SettingsInput } from "./settings-primitives";

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

function NumericRow({
  label,
  description,
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
  description: string;
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
        gap: "12px",
        paddingTop: "12px",
        paddingBottom: "12px",
        borderBottom: last ? "none" : `1px solid ${S.border}`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: S.fs.title, fontWeight: 500, color: S.text }}>{label}</p>
        <p style={{ margin: "2px 0 0", fontSize: S.fs.desc, color: S.textSec }}>{description}</p>
      </div>
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
            width: "72px",
            height: "36px",
            background: S.card,
            border: `1px solid ${S.border}`,
            borderRadius: "8px",
            color: S.text,
            fontSize: "14px",
            padding: "0 10px",
            outline: "none",
            textAlign: "center",
            fontFamily: "inherit",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = S.borderActive; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = S.border; }}
        />
        <span style={{ fontSize: "12px", color: S.textSec, whiteSpace: "nowrap" }}>{unit}</span>
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaved(false);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      await updateClinicOperationalSettings({
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
      setSaving(false);
      setSaved(true);
    }, 1000);
  }, [businessHours, receptionistPhone, takeoverTtlHours, postAppointmentBufferMinutes, staleConversationHours, slotLookaheadDays, mediaTakeoverTtlHours]);

  // Scroll and focus are side effects, so refs must be read after render.
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
      <SettingsSection title="Disponibilidade" description="Informações que a IA usa para responder sobre horários e alertas">
        <SettingsCard>
          <div ref={businessHoursSectionRef} style={{ borderBottom: `1px solid ${S.border}`, paddingBottom: "12px", paddingTop: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <Clock size={14} style={{ color: S.teal, flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: S.fs.title, fontWeight: 500, color: S.text }}>Horário de funcionamento</p>
            </div>
            <SettingsInput
              ref={businessHoursInputRef}
              type="text"
              value={businessHours}
              onChange={(e) => { setBusinessHours(e.target.value); triggerSave({ businessHours: e.target.value }); }}
              placeholder="Ex: Segunda a sexta das 8h às 18h. Sábado das 8h às 13h."
            />
          </div>

          <div style={{ paddingTop: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <Phone size={14} style={{ color: S.teal, flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: S.fs.title, fontWeight: 500, color: S.text }}>Telefone da recepção</p>
            </div>
            <SettingsInput
              type="tel"
              value={receptionistPhone}
              onChange={(e) => { setReceptionistPhone(e.target.value); triggerSave({ receptionistPhone: e.target.value }); }}
              placeholder="Ex: 5511999999999 (com código do país)"
            />
            <p style={{ margin: "6px 0 0", fontSize: "11px", color: S.textMuted }}>
              Recebe alertas quando a IA pede atenção humana
            </p>
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* Comportamento automático */}
      <div ref={takeoverSectionRef}>
        <SettingsSection title="Comportamento automático" description="Controla quando a IA retoma e quanto tempo reserva entre atendimentos">
          <SettingsCard>
            <div ref={bufferSectionRef}>
              <NumericRow
                label="Pausa automática"
                description="Horas até a IA retomar após atendimento humano"
                value={takeoverTtlHours}
                onChange={(v) => { setTakeoverTtlHours(v); triggerSave({ takeoverTtlHours: v }); }}
                min={0} max={72} unit="horas"
                inputRef={takeoverInputRef}
              />
              <NumericRow
                label="Intervalo entre atendimentos"
                description="Buffer de tempo reservado após cada agendamento"
                value={postAppointmentBufferMinutes}
                onChange={(v) => { setPostAppointmentBufferMinutes(v); triggerSave({ postAppointmentBufferMinutes: v }); }}
                min={0} max={240} step={5} unit="min"
                inputRef={bufferInputRef}
              />
              <NumericRow
                label="Janela de agenda"
                description="Quantos dias à frente a IA pode oferecer horários"
                value={slotLookaheadDays}
                onChange={(v) => { setSlotLookaheadDays(v); triggerSave({ slotLookaheadDays: v }); }}
                min={1} max={90} unit="dias"
              />
              <NumericRow
                label="Conversa parada"
                description="Após esse tempo sem resposta, a IA retoma como conversa nova"
                value={staleConversationHours}
                onChange={(v) => { setStaleConversationHours(v); triggerSave({ staleConversationHours: v }); }}
                min={1} max={72} unit="horas"
              />
              <NumericRow
                label="Retorno após mídia"
                description="Horas até a IA retomar após foto, vídeo ou documento. Use 0 para deixar só no humano."
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
        <SaveStatus saving={saving} saved={saved} />
      </div>
    </div>
  );
}
