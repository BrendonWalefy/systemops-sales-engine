"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Bot,
  Clock,
  Stethoscope,
  Workflow,
  DollarSign,
  CheckCircle2,
  Plus,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Sparkles,
  Check,
  AlertCircle,
  Film,
  MessageSquare,
  Camera,
  QrCode,
  Smartphone,
  RefreshCw,
} from "lucide-react";
import {
  saveWizardIdentity,
  saveWizardReceptionist,
  saveWizardSchedule,
  saveWizardTreatments,
  saveWizardPipelines,
  saveWizardPolicy,
} from "./actions";
import type { PipelineStep, ContentBlock } from "@/domain/entities/treatment";
import {
  buildClinicBlueprint,
  type ClinicBlueprint,
} from "@/application/onboarding/clinic-blueprint";
import type { OrgPlan } from "@/application/onboarding/clinic-commercial-settings";
import { DurationHoursInput } from "@/components/DurationHoursInput";

// ─── Types ────────────────────────────────────────────────────────────────────

type MediaItem = {
  id: string;
  title: string;
  url: string;
  type: "video" | "image";
};

type WizardTreatment = {
  id?: string;
  name: string;
  durationMinutes: number;
  requiresEvaluationFirst: boolean;
  isAesthetic: boolean;
  aliases: string;
  pipelineSteps?: PipelineStep[] | null;
};

type PipelineConfig = {
  treatmentId: string;
  treatmentName: string;
  enabled: boolean;
  sendContent: boolean;
  contentMediaIds: string[];
  contentIntroText: string;
  runQA: boolean;
  qaInstruction: string;
  qaMaxTurns: number;
  requestPhoto: boolean;
  photoMessage: string;
  photoRequired: boolean;
};

type WizardInitial = {
  identity: {
    specialty: string;
    city: string;
    address: string;
    greetingMessage: string;
  };
  receptionist: { toneOfVoice: string; differentials: string[] };
  schedule: {
    businessHours: string;
    calendarMode: "internal" | "google_calendar";
    googleCalendarId: string;
    receptionistPhone: string;
    defaultDurationMinutes: number;
    bufferMinutes: number;
    takeoverTtlHours: number;
  };
  channel: {
    provider: "z_api" | "meta_cloud_api";
    zapiInstanceId: string;
    zapiToken: string;
    zapiClientToken: string;
    metaPhoneNumberId: string;
    metaAccessToken: string;
  };
  treatments: WizardTreatment[];
  policy: {
    commercialPolicy: string;
    notes: string;
    plan: OrgPlan;
    billingActive: boolean;
    monthlyRevenueBrl: string;
    billingStartedAt: string;
    isTest: boolean;
  };
  mediaLibrary: MediaItem[];
  autoReplyEnabled: boolean;
};

type Props = {
  clinicId: string;
  clinicName: string;
  initial: WizardInitial;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toPipelineSteps(config: PipelineConfig): PipelineStep[] {
  if (!config.enabled) return [];
  const steps: PipelineStep[] = [];

  if (
    config.sendContent &&
    (config.contentIntroText.trim() || config.contentMediaIds.length > 0)
  ) {
    const blocks: ContentBlock[] = [];
    if (config.contentIntroText.trim())
      blocks.push({ kind: "text", content: config.contentIntroText.trim() });
    config.contentMediaIds.forEach((id) =>
      blocks.push({ kind: "media", mediaId: id }),
    );
    if (blocks.length > 0)
      steps.push({
        type: "content",
        label: "Apresentação do serviço",
        blocks,
      });
  }
  if (config.runQA) {
    steps.push({
      type: "qa",
      label: "Sessão de dúvidas",
      instruction: config.qaInstruction.trim() || undefined,
      maxTurns: config.qaMaxTurns,
    });
  }
  if (config.requestPhoto) {
    steps.push({
      type: "photo",
      label: "Solicitar foto",
      message:
        config.photoMessage ||
        "Você poderia nos enviar uma foto para personalizar sua avaliação?",
      required: config.photoRequired,
    });
  }
  steps.push({ type: "ask_availability", label: "Perguntar disponibilidade" });
  steps.push({ type: "offer_slots", label: "Mostrar horários" });
  steps.push({ type: "book", label: "Confirmar agendamento" });
  return steps;
}

function initPipelineConfig(t: WizardTreatment): PipelineConfig {
  const steps = t.pipelineSteps ?? [];
  const contentStep = steps.find((s) => s.type === "content");
  const qaStep = steps.find((s) => s.type === "qa");
  const photoStep = steps.find((s) => s.type === "photo");

  return {
    treatmentId: t.id ?? "",
    treatmentName: t.name,
    enabled: steps.length > 0,
    sendContent: !!contentStep,
    contentMediaIds: contentStep
      ? contentStep.blocks
          .filter((b) => b.kind === "media")
          .map((b) => (b as { kind: "media"; mediaId: string }).mediaId)
      : [],
    contentIntroText: contentStep
      ? ((
          contentStep.blocks.find((b) => b.kind === "text") as
            | { kind: "text"; content: string }
            | undefined
        )?.content ?? "")
      : "",
    runQA: !!qaStep,
    qaInstruction:
      qaStep && "instruction" in qaStep ? (qaStep.instruction ?? "") : "",
    qaMaxTurns: qaStep && "maxTurns" in qaStep ? (qaStep.maxTurns ?? 10) : 10,
    requestPhoto: !!photoStep,
    photoMessage: photoStep && "message" in photoStep ? photoStep.message : "",
    photoRequired:
      photoStep && "required" in photoStep ? photoStep.required : false,
  };
}

// ─── Step config ──────────────────────────────────────────────────────────────

const STEPS = [
  {
    id: 1,
    title: "Identidade da organização",
    subtitle: "Nome, segmento, localização e canal",
    Icon: Building2,
  },
  {
    id: 2,
    title: "Recepcionista virtual",
    subtitle: "Tom de voz e diferenciais",
    Icon: Bot,
  },
  {
    id: 3,
    title: "Horários e agenda",
    subtitle: "Funcionamento, handoff e fonte da agenda",
    Icon: Clock,
  },
  {
    id: 4,
    title: "Serviços",
    subtitle: "O que a organização oferece",
    Icon: Stethoscope,
  },
  {
    id: 5,
    title: "Jornada do lead",
    subtitle: "Como a IA conduz conversas estéticas",
    Icon: Workflow,
  },
  {
    id: 6,
    title: "Valores e política",
    subtitle: "Cobrança, plano comercial e regras da IA",
    Icon: DollarSign,
  },
  {
    id: 7,
    title: "Revisão final",
    subtitle: "Confirme e conclua o onboarding",
    Icon: CheckCircle2,
  },
];

const TONE_OPTIONS = [
  {
    value: "acolhedor",
    label: "Acolhedor",
    desc: "Empático e próximo, faz o cliente se sentir acolhido",
  },
  {
    value: "profissional",
    label: "Profissional",
    desc: "Formal, transmite confiança e expertise",
  },
  {
    value: "sofisticado",
    label: "Sofisticado",
    desc: "Refinado, para marcas premium e de luxo",
  },
  {
    value: "descontraido",
    label: "Descontraído",
    desc: "Casual e amigável, comunicação leve",
  },
];

const HOURS_PRESETS = [
  "Seg-Sex 8h-18h",
  "Seg-Sex 8h-18h, Sáb 8h-12h",
  "Seg-Sex 9h-19h, Sáb 9h-13h",
  "Seg-Sex 7h-17h",
  "Seg-Sáb 8h-18h",
  "Personalizado",
];

// ─── UI helpers ───────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: "11px",
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--muted)",
        marginBottom: "10px",
      }}
    >
      {children}
    </p>
  );
}

function ToggleCard({
  checked,
  onChange,
  label,
  desc,
  Icon,
  color,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
  Icon?: React.ElementType;
  color?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: `1px solid ${checked ? (color ?? "var(--accent)") + "44" : "rgba(255,255,255,0.08)"}`,
        borderRadius: "12px",
        overflow: "hidden",
        transition: "border-color 0.15s",
      }}
    >
      <button
        type="button"
        onClick={() => onChange(!checked)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "14px 16px",
          width: "100%",
          background: checked ? `${color ?? "#00d4aa"}0a` : "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
          transition: "background 0.15s",
        }}
      >
        <div
          style={{
            width: "20px",
            height: "20px",
            borderRadius: "6px",
            border: `2px solid ${checked ? (color ?? "var(--accent)") : "rgba(255,255,255,0.2)"}`,
            background: checked ? (color ?? "var(--accent)") : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "all 0.15s",
          }}
        >
          {checked && <Check size={12} strokeWidth={3} color="#000" />}
        </div>
        {Icon && (
          <Icon
            size={16}
            strokeWidth={2}
            style={{
              color: checked ? (color ?? "var(--accent)") : "var(--muted)",
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "14px", fontWeight: 600 }}>{label}</div>
          {desc && (
            <div
              style={{
                fontSize: "12px",
                color: "var(--muted)",
                marginTop: "2px",
              }}
            >
              {desc}
            </div>
          )}
        </div>
      </button>
      {checked && children && (
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        fontSize: "13px",
        color: "var(--muted)",
        marginBottom: "4px",
        display: "block",
      }}
    >
      {children}
    </label>
  );
}

// ─── Step components ──────────────────────────────────────────────────────────

function StepIdentidade({
  data,
  channel,
  onChange,
  onChannelChange,
  clinicId,
}: {
  data: WizardInitial["identity"];
  channel: WizardInitial["channel"];
  onChange: (d: WizardInitial["identity"]) => void;
  onChannelChange: (d: WizardInitial["channel"]) => void;
  clinicId: string;
}) {
  const f =
    (field: keyof typeof data) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...data, [field]: e.target.value });

  // ─── WA Pairing States ───────────────────────────────────────────────────────
  type PairingPhase =
    | "idle"
    | "saving"
    | "loading_qr"
    | "showing_qr"
    | "loading_phone_code"
    | "showing_phone_code"
    | "polling"
    | "connected"
    | "error";

  const [pairingPhase, setPairingPhase] = useState<PairingPhase>("idle");
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [phoneCode, setPhoneCode] = useState<string | null>(null);
  const [phoneForCode, setPhoneForCode] = useState<string>("");

  // Polling helper
  const recordPairing = useCallback(async () => {
    try {
      await fetch(`/api/owner/clinics/${clinicId}/channel-pairing?action=record-pairing`, {
        method: "POST",
      });
    } catch (e) {
      console.error("Failed to record pairing timestamp:", e);
    }
  }, [clinicId]);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/owner/clinics/${clinicId}/channel-pairing?action=status`);
      if (res.ok) {
        const json = await res.json();
        if (json.connected) {
          setPairingPhase("connected");
          await recordPairing();
          return true; // connected
        }
      }
    } catch (e) {
      console.error("Polling error:", e);
    }
    return false;
  }, [clinicId, recordPairing]);

  const startPairing = async (mode: "qr" | "phone") => {
    setPairingError(null);
    if (!channel.zapiInstanceId || !channel.zapiToken) {
      setPairingPhase("error");
      setPairingError("Preencha Z-API Instance ID e Z-API Token para conectar.");
      return;
    }

    setPairingPhase("saving");
    // Salvar credenciais no banco primeiro para que o endpoint de pairing do backend as encontre criptografadas.
    const saveResult = await saveWizardIdentity(clinicId, {
      ...data,
      channelProvider: channel.provider,
      zapiInstanceId: channel.zapiInstanceId,
      zapiToken: channel.zapiToken,
      zapiClientToken: channel.zapiClientToken,
      metaPhoneNumberId: channel.metaPhoneNumberId,
      metaAccessToken: channel.metaAccessToken,
    });

    if (!saveResult.success) {
      setPairingPhase("error");
      setPairingError(saveResult.error ?? "Erro ao salvar credenciais antes de parear.");
      return;
    }

    if (mode === "qr") {
      await fetchQrCode();
    } else {
      await fetchPhoneCode();
    }
  };

  const fetchQrCode = async () => {
    setPairingPhase("loading_qr");
    try {
      const res = await fetch(`/api/owner/clinics/${clinicId}/channel-pairing?action=qr-code`);
      if (!res.ok) {
        throw new Error("Erro ao buscar QR code da API");
      }
      const json = await res.json();
      if (json.status === "qr" && json.base64) {
        setQrCodeBase64(json.base64);
        setPairingPhase("showing_qr");
      } else if (json.status === "connected") {
        setPairingPhase("connected");
        await recordPairing();
      } else {
        setPairingPhase("error");
        setPairingError(json.message ?? "QR Code expirado ou indisponível. Tente novamente.");
      }
    } catch (err) {
      setPairingPhase("error");
      setPairingError(err instanceof Error ? err.message : "Erro desconhecido");
    }
  };

  const fetchPhoneCode = async () => {
    if (!phoneForCode) {
      setPairingPhase("error");
      setPairingError("Digite um número de telefone com DDI e DDD (ex: 5511999999999)");
      return;
    }
    setPairingPhase("loading_phone_code");
    try {
      const res = await fetch(`/api/owner/clinics/${clinicId}/channel-pairing?action=phone-code&phone=${encodeURIComponent(phoneForCode)}`);
      if (!res.ok) {
        throw new Error("Erro ao buscar código de telefone da API");
      }
      const json = await res.json();
      if (json.status === "code" && json.code) {
        setPhoneCode(json.code);
        setPairingPhase("showing_phone_code");
      } else if (json.status === "connected") {
        setPairingPhase("connected");
        await recordPairing();
      } else {
        setPairingPhase("error");
        setPairingError(json.message ?? "Não foi possível gerar o código. Verifique as credenciais.");
      }
    } catch (err) {
      setPairingPhase("error");
      setPairingError(err instanceof Error ? err.message : "Erro desconhecido");
    }
  };

  // Poll connection status every 3 seconds when showing QR or Phone Code
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined = undefined;
    if (pairingPhase === "showing_qr" || pairingPhase === "showing_phone_code") {
      intervalId = setInterval(async () => {
        const isConnected = await pollStatus();
        if (isConnected) {
          clearInterval(intervalId);
        }
      }, 3000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [pairingPhase, pollStatus]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <FieldLabel>Categoria principal</FieldLabel>
        <input
          value={data.specialty}
          onChange={f("specialty")}
          placeholder="Ex: odontologia, barbearia, cortinas, consultoria..."
          style={inputStyle}
        />
      </div>
      <div>
        <FieldLabel>Cidade</FieldLabel>
        <input
          value={data.city}
          onChange={f("city")}
          placeholder="Ex: São Paulo"
          style={inputStyle}
        />
      </div>
      <div>
        <FieldLabel>Endereço completo</FieldLabel>
        <input
          value={data.address}
          onChange={f("address")}
          placeholder="Rua, número, bairro — aparece na confirmação de agendamento"
          style={inputStyle}
        />
      </div>
      <div>
        <FieldLabel>Mensagem de boas-vindas da IA</FieldLabel>
        <textarea
          value={data.greetingMessage}
          onChange={f("greetingMessage")}
          placeholder="Ex: Ola! Sou a assistente virtual da empresa. Como posso ajudar?"
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>

      <div>
        <SectionTitle>Canal de atendimento</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <FieldLabel>Provedor do WhatsApp</FieldLabel>
            <select
              value={channel.provider}
              onChange={(e) =>
                onChannelChange({
                  ...channel,
                  provider: e.target
                    .value as WizardInitial["channel"]["provider"],
                })
              }
              style={inputStyle}
            >
              <option value="z_api">Z-API</option>
              <option value="meta_cloud_api">Meta Cloud API</option>
            </select>
          </div>

          {channel.provider === "z_api" ? (
            <>
              <div>
                <FieldLabel>Z-API Instance ID</FieldLabel>
                <input
                  value={channel.zapiInstanceId}
                  onChange={(e) =>
                    onChannelChange({
                      ...channel,
                      zapiInstanceId: e.target.value,
                    })
                  }
                  placeholder="Instância da organização"
                  style={inputStyle}
                />
              </div>
              <div>
                <FieldLabel>Z-API Token</FieldLabel>
                <input
                  value={channel.zapiToken}
                  onChange={(e) =>
                    onChannelChange({ ...channel, zapiToken: e.target.value })
                  }
                  placeholder="Token principal"
                  style={inputStyle}
                />
              </div>
              <div>
                <FieldLabel>Z-API Client Token</FieldLabel>
                <input
                  value={channel.zapiClientToken}
                  onChange={(e) =>
                    onChannelChange({
                      ...channel,
                      zapiClientToken: e.target.value,
                    })
                  }
                  placeholder="Opcional"
                  style={inputStyle}
                />
              </div>

              {/* Sub-passo: Conectar WhatsApp */}
              <div
                style={{
                  marginTop: "12px",
                  padding: "16px 20px",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                <div style={{ fontSize: "14px", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>Conectar WhatsApp (Z-API)</span>
                  <span style={{ fontSize: "11px", fontWeight: "normal", color: "var(--muted)" }}>(Opcional)</span>
                </div>

                {pairingPhase === "idle" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)", lineHeight: 1.5 }}>
                      Você pode conectar o celular escaneando o QR Code ou digitando um código no WhatsApp. As credenciais acima serão salvas automaticamente ao iniciar.
                    </p>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => startPairing("qr")}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "10px 16px",
                          borderRadius: "8px",
                          border: "1px solid var(--accent)",
                          background: "transparent",
                          color: "var(--accent)",
                          fontSize: "13px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        <QrCode size={14} />
                        Gerar QR Code
                      </button>

                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <input
                          value={phoneForCode}
                          onChange={(e) => setPhoneForCode(e.target.value)}
                          placeholder="5511999999999"
                          style={{
                            ...inputStyle,
                            width: "140px",
                            padding: "8px 10px",
                            fontSize: "13px",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => startPairing("phone")}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "10px 16px",
                            borderRadius: "8px",
                            border: "1px solid rgba(255,255,255,0.15)",
                            background: "rgba(255,255,255,0.05)",
                            color: "var(--foreground)",
                            fontSize: "13px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          <Smartphone size={14} />
                          Gerar Código
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {(pairingPhase === "saving" ||
                  pairingPhase === "loading_qr" ||
                  pairingPhase === "loading_phone_code") && (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0" }}>
                    <Loader2 size={16} className="spin" style={{ animation: "spin 1s linear infinite" }} />
                    <span style={{ fontSize: "13px", color: "var(--muted)" }}>
                      {pairingPhase === "saving" && "Salvando credenciais..."}
                      {pairingPhase === "loading_qr" && "Gerando QR Code..."}
                      {pairingPhase === "loading_phone_code" && "Gerando código de pareamento..."}
                    </span>
                  </div>
                )}

                {pairingPhase === "showing_qr" && qrCodeBase64 && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", padding: "10px 0" }}>
                    <div style={{ background: "white", padding: "10px", borderRadius: "12px", display: "inline-block" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`data:image/png;base64,${qrCodeBase64}`}
                        alt="Z-API QR Code"
                        style={{ width: "180px", height: "180px", display: "block" }}
                      />
                    </div>
                    <div style={{ textAlign: "center", maxWidth: "320px" }}>
                      <p style={{ margin: 0, fontSize: "12px", color: "var(--foreground)", fontWeight: 600 }}>
                        Escaneie o QR Code no seu WhatsApp
                      </p>
                      <p style={{ margin: "4px 0 0", fontSize: "11px", color: "var(--muted)", lineHeight: 1.4 }}>
                        Acesse WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho.
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--accent)", fontSize: "12px" }}>
                      <Loader2 size={12} className="spin" style={{ animation: "spin 1.5s linear infinite" }} />
                      <span>Aguardando leitura do QR Code...</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => fetchQrCode()}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--muted)",
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <RefreshCw size={12} /> Atualizar QR Code
                    </button>
                  </div>
                )}

                {pairingPhase === "showing_phone_code" && phoneCode && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", padding: "10px 0" }}>
                    <div
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "10px",
                        padding: "12px 24px",
                        fontSize: "24px",
                        fontWeight: 700,
                        letterSpacing: "4px",
                        fontFamily: "monospace",
                        color: "var(--accent)",
                      }}
                    >
                      {phoneCode}
                    </div>
                    <div style={{ textAlign: "center", maxWidth: "340px" }}>
                      <p style={{ margin: 0, fontSize: "12px", color: "var(--foreground)", fontWeight: 600 }}>
                        Insira o código acima no seu WhatsApp
                      </p>
                      <p style={{ margin: "4px 0 0", fontSize: "11px", color: "var(--muted)", lineHeight: 1.4 }}>
                        Acesse Aparelhos conectados &gt; Conectar com número de telefone.
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--accent)", fontSize: "12px" }}>
                      <Loader2 size={12} className="spin" style={{ animation: "spin 1.5s linear infinite" }} />
                      <span>Aguardando pareamento do código...</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => fetchPhoneCode()}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--muted)",
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <RefreshCw size={12} /> Gerar novo código
                    </button>
                  </div>
                )}

                {pairingPhase === "connected" && (
                  <div
                    style={{
                      padding: "10px 14px",
                      background: "rgba(16,185,129,0.08)",
                      border: "1px solid rgba(16,185,129,0.22)",
                      borderRadius: "8px",
                      color: "#34d399",
                      fontSize: "13px",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <CheckCircle2 size={14} />
                    WhatsApp conectado com sucesso!
                  </div>
                )}

                {pairingPhase === "error" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div
                      style={{
                        padding: "10px 14px",
                        background: "rgba(248,113,113,0.08)",
                        border: "1px solid rgba(248,113,113,0.22)",
                        borderRadius: "8px",
                        color: "#f87171",
                        fontSize: "13px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <AlertCircle size={14} />
                      <span>{pairingError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPairingPhase("idle")}
                      style={{
                        alignSelf: "flex-start",
                        background: "transparent",
                        border: "none",
                        color: "var(--accent)",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}

                {pairingPhase !== "idle" && pairingPhase !== "connected" && (
                  <button
                    type="button"
                    onClick={() => {
                      setPairingPhase("idle");
                      setQrCodeBase64(null);
                      setPhoneCode(null);
                    }}
                    style={{
                      alignSelf: "flex-start",
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      fontSize: "12px",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Voltar / Cancelar
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <FieldLabel>Meta Phone Number ID</FieldLabel>
                <input
                  value={channel.metaPhoneNumberId}
                  onChange={(e) =>
                    onChannelChange({
                      ...channel,
                      metaPhoneNumberId: e.target.value,
                    })
                  }
                  placeholder="ID do número"
                  style={inputStyle}
                />
              </div>
              <div>
                <FieldLabel>Meta Access Token</FieldLabel>
                <input
                  value={channel.metaAccessToken}
                  onChange={(e) =>
                    onChannelChange({
                      ...channel,
                      metaAccessToken: e.target.value,
                    })
                  }
                  placeholder="Token de acesso"
                  style={inputStyle}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StepRecepcionista({
  data,
  onChange,
}: {
  data: WizardInitial["receptionist"];
  onChange: (d: WizardInitial["receptionist"]) => void;
}) {
  function addDifferential() {
    if (data.differentials.length >= 6) return;
    onChange({ ...data, differentials: [...data.differentials, ""] });
  }
  function updateDiff(i: number, val: string) {
    const next = [...data.differentials];
    next[i] = val;
    onChange({ ...data, differentials: next });
  }
  function removeDiff(i: number) {
    onChange({
      ...data,
      differentials: data.differentials.filter((_, idx) => idx !== i),
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div>
        <SectionTitle>Tom de voz da recepcionista</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...data, toneOfVoice: opt.value })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "14px 16px",
                borderRadius: "12px",
                border: `2px solid ${data.toneOfVoice === opt.value ? "var(--accent)" : "rgba(255,255,255,0.08)"}`,
                background:
                  data.toneOfVoice === opt.value
                    ? "rgba(0,212,170,0.06)"
                    : "transparent",
                cursor: "pointer",
                textAlign: "left",
                color: "inherit",
                transition: "all 0.15s",
              }}
            >
              <div
                style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: "50%",
                  border: `2px solid ${data.toneOfVoice === opt.value ? "var(--accent)" : "rgba(255,255,255,0.2)"}`,
                  background:
                    data.toneOfVoice === opt.value
                      ? "var(--accent)"
                      : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {data.toneOfVoice === opt.value && (
                  <div
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "#000",
                    }}
                  />
                )}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: "14px" }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                  {opt.desc}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle>
          Diferenciais da organização ({data.differentials.length}/6)
        </SectionTitle>
        <p
          style={{
            fontSize: "12px",
            color: "var(--muted)",
            marginBottom: "12px",
          }}
        >
          O que faz esta organização se destacar? A IA menciona esses pontos nas
          conversas.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {data.differentials.map((d, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: "8px", alignItems: "center" }}
            >
              <span
                style={{
                  color: "var(--accent)",
                  fontSize: "12px",
                  fontWeight: 700,
                  minWidth: "18px",
                }}
              >
                {i + 1}.
              </span>
              <input
                value={d}
                onChange={(e) => updateDiff(i, e.target.value)}
                placeholder={`Ex: ${["Mais de 15 anos de experiencia", "Atendimento rapido", "Equipe especializada", "Avaliacao gratuita"][i] ?? "Diferencial da organizacao"}`}
                style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
              />
              <button
                type="button"
                onClick={() => removeDiff(i)}
                style={iconBtnStyle}
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
          {data.differentials.length < 6 && (
            <button type="button" onClick={addDifferential} style={addBtnStyle}>
              <Plus size={14} strokeWidth={2.5} /> Adicionar diferencial
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepHorarios({
  data,
  onChange,
}: {
  data: WizardInitial["schedule"];
  onChange: (d: WizardInitial["schedule"]) => void;
}) {
  const isCustom = !HOURS_PRESETS.slice(0, -1).includes(data.businessHours);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div>
        <SectionTitle>Horários de funcionamento</SectionTitle>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            marginBottom: "10px",
          }}
        >
          {HOURS_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                if (preset !== "Personalizado")
                  onChange({ ...data, businessHours: preset });
              }}
              style={{
                padding: "10px 14px",
                borderRadius: "10px",
                border: `1px solid ${(preset === "Personalizado" ? isCustom : data.businessHours === preset) ? "var(--accent)" : "rgba(255,255,255,0.08)"}`,
                background: (
                  preset === "Personalizado"
                    ? isCustom
                    : data.businessHours === preset
                )
                  ? "rgba(0,212,170,0.06)"
                  : "transparent",
                cursor: "pointer",
                textAlign: "left",
                color: "inherit",
                fontSize: "13px",
                fontWeight: (
                  preset === "Personalizado"
                    ? isCustom
                    : data.businessHours === preset
                )
                  ? 600
                  : 400,
              }}
            >
              {preset === "Personalizado" ? "Personalizado..." : preset}
            </button>
          ))}
        </div>
        {isCustom && (
          <input
            value={data.businessHours}
            onChange={(e) =>
              onChange({ ...data, businessHours: e.target.value })
            }
            placeholder="Ex: Ter-Sáb 9h-18h, Dom 10h-14h"
            style={inputStyle}
          />
        )}
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}
      >
        <div>
          <FieldLabel>Duração padrão do atendimento</FieldLabel>
          <select
            value={data.defaultDurationMinutes}
            onChange={(e) =>
              onChange({
                ...data,
                defaultDurationMinutes: Number(e.target.value),
              })
            }
            style={inputStyle}
          >
            {[30, 45, 60, 90, 120].map((n) => (
              <option key={n} value={n}>
                {n} min{n >= 60 ? ` (${n / 60}h)` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel>Intervalo entre atendimentos</FieldLabel>
          <select
            value={data.bufferMinutes}
            onChange={(e) =>
              onChange({ ...data, bufferMinutes: Number(e.target.value) })
            }
            style={inputStyle}
          >
            {[0, 15, 30, 45, 60].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Sem intervalo" : `${n} min`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <SectionTitle>Agenda e handoff</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <FieldLabel>Telefone da recepção humana</FieldLabel>
            <input
              value={data.receptionistPhone}
              onChange={(e) =>
                onChange({ ...data, receptionistPhone: e.target.value })
              }
              placeholder="+55 11 99999-9999"
              style={inputStyle}
            />
          </div>
          <div>
            <FieldLabel>Fonte da agenda</FieldLabel>
            <select
              value={data.calendarMode}
              onChange={(e) =>
                onChange({
                  ...data,
                  calendarMode: e.target
                    .value as WizardInitial["schedule"]["calendarMode"],
                })
              }
              style={inputStyle}
            >
              <option value="internal">Agenda interna</option>
              <option value="google_calendar">Google Calendar</option>
            </select>
          </div>
          {data.calendarMode === "google_calendar" && (
            <div>
              <FieldLabel>Google Calendar ID</FieldLabel>
              <input
                value={data.googleCalendarId}
                onChange={(e) =>
                  onChange({ ...data, googleCalendarId: e.target.value })
                }
                placeholder="Obrigatório para usar Google Calendar"
                style={inputStyle}
              />
            </div>
          )}
        </div>
      </div>

      <div>
        <FieldLabel>Tempo até a IA retomar após pausa humana</FieldLabel>
        <p
          style={{
            fontSize: "12px",
            color: "var(--muted)",
            marginBottom: "8px",
          }}
        >
          Quando a equipe pausa a IA para atender manualmente, após quanto tempo
          a IA volta sozinha?
        </p>
        <select
          value={data.takeoverTtlHours}
          onChange={(e) =>
            onChange({ ...data, takeoverTtlHours: Number(e.target.value) })
          }
          style={inputStyle}
        >
          {[1, 2, 4, 8, 24].map((n) => (
            <option key={n} value={n}>
              {n === 1
                ? "1 hora"
                : n === 24
                  ? "24 horas (1 dia)"
                  : `${n} horas`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function StepProcedimentos({
  data,
  onChange,
}: {
  data: WizardTreatment[];
  onChange: (d: WizardTreatment[]) => void;
}) {
  function add() {
    onChange([
      ...data,
      {
        name: "",
        durationMinutes: 60,
        requiresEvaluationFirst: false,
        isAesthetic: false,
        aliases: "",
      },
    ]);
  }
  function update(i: number, patch: Partial<WizardTreatment>) {
    onChange(data.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function remove(i: number) {
    onChange(data.filter((_, idx) => idx !== i));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <p
        style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "4px" }}
      >
        Liste os serviços, produtos ou ofertas que a organização atende pelo WhatsApp.
        A IA usará essas informações para responder perguntas e sugerir agendamentos.
      </p>

      {data.map((t, i) => (
        <div
          key={i}
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "12px",
            padding: "14px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div
            style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}
          >
            <input
              value={t.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Nome do serviço"
              style={{ ...inputStyle, flex: 1, fontWeight: 600 }}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              style={{ ...iconBtnStyle, color: "#f87171", marginTop: "2px" }}
            >
              <Trash2 size={14} strokeWidth={2} />
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
            }}
          >
            <div>
              <FieldLabel>Duração</FieldLabel>
              <DurationHoursInput
                minutes={t.durationMinutes}
                onChangeMinutes={(m) => update(i, { durationMinutes: m })}
                inputStyle={inputStyle}
              />
            </div>
            <div>
              <FieldLabel>Outros nomes</FieldLabel>
              <input
                value={t.aliases}
                onChange={(e) => update(i, { aliases: e.target.value })}
                placeholder="faceta, lente, resina..."
                style={{ ...inputStyle, fontSize: "12px" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              <input
                type="checkbox"
                checked={t.requiresEvaluationFirst}
                onChange={(e) =>
                  update(i, { requiresEvaluationFirst: e.target.checked })
                }
                style={{ width: "16px", height: "16px" }}
              />
              Exige avaliação antes do agendamento
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              <input
                type="checkbox"
                checked={t.isAesthetic}
                onChange={(e) => update(i, { isAesthetic: e.target.checked })}
                style={{ width: "16px", height: "16px" }}
              />
              <span
                style={{ display: "flex", alignItems: "center", gap: "4px" }}
              >
                <Sparkles
                  size={13}
                  strokeWidth={2}
                  style={{ color: "#a78bfa" }}
                />
                Jornada guiada
              </span>
            </label>
          </div>
        </div>
      ))}

      <button type="button" onClick={add} style={addBtnStyle}>
        <Plus size={14} strokeWidth={2.5} /> Adicionar serviço
      </button>

      {data.filter((t) => t.isAesthetic).length > 0 && (
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(139,92,246,0.08)",
            border: "1px solid rgba(139,92,246,0.2)",
            borderRadius: "10px",
            fontSize: "12px",
            color: "#a78bfa",
          }}
        >
          <strong>
            {data.filter((t) => t.isAesthetic).length} serviço(s) com jornada guiada
          </strong>{" "}
          — no próximo passo você configurará a jornada da IA para cada um.
        </div>
      )}
    </div>
  );
}

function StepJornada({
  treatments,
  pipelines,
  onChange,
  mediaLibrary,
}: {
  treatments: WizardTreatment[];
  pipelines: PipelineConfig[];
  onChange: (p: PipelineConfig[]) => void;
  mediaLibrary: MediaItem[];
}) {
  const aesthetic = treatments.filter((t) => t.isAesthetic && t.id);

  if (aesthetic.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "32px 16px",
          color: "var(--muted)",
        }}
      >
        <Workflow
          size={32}
          strokeWidth={1.5}
          style={{ marginBottom: "12px", opacity: 0.4 }}
        />
        <p style={{ fontSize: "14px", marginBottom: "4px" }}>
          Nenhum serviço com jornada guiada configurado
        </p>
        <p style={{ fontSize: "12px" }}>
          Volte ao passo anterior e marque os serviços que precisam de jornada guiada.
        </p>
      </div>
    );
  }

  function updatePipeline(treatmentId: string, patch: Partial<PipelineConfig>) {
    onChange(
      pipelines.map((p) =>
        p.treatmentId === treatmentId ? { ...p, ...patch } : p,
      ),
    );
  }

  function toggleMedia(treatmentId: string, mediaId: string) {
    const current = pipelines.find((p) => p.treatmentId === treatmentId);
    if (!current) return;
    const ids = current.contentMediaIds.includes(mediaId)
      ? current.contentMediaIds.filter((id) => id !== mediaId)
      : [...current.contentMediaIds, mediaId];
    updatePipeline(treatmentId, { contentMediaIds: ids });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ fontSize: "13px", color: "var(--muted)" }}>
        Para serviços com jornada guiada, você pode configurar uma{" "}
        <strong style={{ color: "var(--foreground)" }}>
          sequência de conversa
        </strong>{" "}
        — a IA apresenta vídeos, tira dúvidas e solicita foto antes de oferecer
        horários.
      </p>

      {aesthetic.map((t) => {
        const cfg = pipelines.find((p) => p.treatmentId === t.id) ?? {
          treatmentId: t.id!,
          treatmentName: t.name,
          enabled: false,
          sendContent: false,
          contentMediaIds: [],
          contentIntroText: "",
          runQA: false,
          qaInstruction: "",
          qaMaxTurns: 10,
          requestPhoto: false,
          photoMessage: "",
          photoRequired: false,
        };

        return (
          <div
            key={t.id}
            style={{
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "14px",
              overflow: "hidden",
            }}
          >
            {/* Treatment header */}
            <div
              style={{
                padding: "14px 16px",
                background: "rgba(139,92,246,0.06)",
                display: "flex",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <Sparkles
                size={15}
                strokeWidth={2}
                style={{ color: "#a78bfa", flexShrink: 0 }}
              />
              <span style={{ fontWeight: 700, fontSize: "15px", flex: 1 }}>
                {t.name}
              </span>
            </div>

            <div
              style={{
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              {/* Enable toggle */}
              <div style={{ display: "flex", gap: "12px" }}>
                {(["disabled", "enabled"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      updatePipeline(t.id!, { enabled: opt === "enabled" })
                    }
                    style={{
                      flex: 1,
                      padding: "10px",
                      borderRadius: "10px",
                      border: `2px solid ${(opt === "enabled") === cfg.enabled ? (opt === "enabled" ? "#a78bfa" : "rgba(255,255,255,0.2)") : "rgba(255,255,255,0.08)"}`,
                      background:
                        (opt === "enabled") === cfg.enabled
                          ? opt === "enabled"
                            ? "rgba(139,92,246,0.1)"
                            : "rgba(255,255,255,0.04)"
                          : "transparent",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: 600,
                      color:
                        (opt === "enabled") === cfg.enabled
                          ? opt === "enabled"
                            ? "#a78bfa"
                            : "var(--foreground)"
                          : "var(--muted)",
                    }}
                  >
                    {opt === "enabled"
                      ? "Configurar jornada"
                      : "Resposta livre"}
                  </button>
                ))}
              </div>

              {cfg.enabled && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    paddingTop: "4px",
                  }}
                >
                  {/* Content */}
                  <ToggleCard
                    checked={cfg.sendContent}
                    onChange={(v) => updatePipeline(t.id!, { sendContent: v })}
                    label="Enviar vídeos de apresentação"
                    desc="A IA apresenta o serviço com vídeos antes de responder perguntas"
                    Icon={Film}
                    color="#60a5fa"
                  >
                    <div>
                      <FieldLabel>Texto de introdução (opcional)</FieldLabel>
                      <textarea
                        value={cfg.contentIntroText}
                        onChange={(e) =>
                          updatePipeline(t.id!, {
                            contentIntroText: e.target.value,
                          })
                        }
                        placeholder="Ex: Trabalhamos com duas opções para esse serviço:"
                        rows={2}
                        style={{ ...inputStyle, resize: "vertical" }}
                      />
                    </div>
                    {mediaLibrary.length > 0 && (
                      <div>
                        <FieldLabel>Selecionar vídeos</FieldLabel>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                          }}
                        >
                          {mediaLibrary
                            .filter((m) => m.type === "video")
                            .map((m) => (
                              <label
                                key={m.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "10px",
                                  cursor: "pointer",
                                  fontSize: "13px",
                                  padding: "8px 10px",
                                  borderRadius: "8px",
                                  background: "rgba(255,255,255,0.03)",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={cfg.contentMediaIds.includes(m.id)}
                                  onChange={() => toggleMedia(t.id!, m.id)}
                                  style={{ width: "16px", height: "16px" }}
                                />
                                <Film
                                  size={13}
                                  strokeWidth={2}
                                  style={{ color: "#60a5fa", flexShrink: 0 }}
                                />
                                {m.title || m.url}
                              </label>
                            ))}
                        </div>
                      </div>
                    )}
                    {mediaLibrary.filter((m) => m.type === "video").length ===
                      0 && (
                      <p style={{ fontSize: "12px", color: "var(--muted)" }}>
                        Nenhum vídeo na biblioteca. Adicione em Configurações →
                        Biblioteca de Mídia.
                      </p>
                    )}
                  </ToggleCard>

                  {/* Q&A */}
                  <ToggleCard
                    checked={cfg.runQA}
                    onChange={(v) => updatePipeline(t.id!, { runQA: v })}
                    label="Período de dúvidas guiado"
                    desc="A IA fica disponível para perguntas com uma orientação específica"
                    Icon={MessageSquare}
                    color="#a78bfa"
                  >
                    <div>
                      <FieldLabel>Orientação para a IA (opcional)</FieldLabel>
                      <textarea
                        value={cfg.qaInstruction}
                        onChange={(e) =>
                          updatePipeline(t.id!, {
                            qaInstruction: e.target.value,
                          })
                        }
                        placeholder="Ex: Responda dúvidas sobre as técnicas. Não mencione preços além da política comercial."
                        rows={2}
                        style={{ ...inputStyle, resize: "vertical" }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      <FieldLabel>
                        Máx. trocas antes de sugerir agendamento:
                      </FieldLabel>
                      <select
                        value={cfg.qaMaxTurns}
                        onChange={(e) =>
                          updatePipeline(t.id!, {
                            qaMaxTurns: Number(e.target.value),
                          })
                        }
                        style={{ ...inputStyle, width: "80px", margin: 0 }}
                      >
                        {[5, 8, 10, 15, 20].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  </ToggleCard>

                  {/* Photo */}
                  <ToggleCard
                    checked={cfg.requestPhoto}
                    onChange={(v) => updatePipeline(t.id!, { requestPhoto: v })}
                    label="Solicitar foto do cliente"
                    desc="A IA pede uma foto para personalizar a avaliação"
                    Icon={Camera}
                    color="#34d399"
                  >
                    <div>
                      <FieldLabel>Mensagem enviada ao cliente</FieldLabel>
                      <textarea
                        value={cfg.photoMessage}
                        onChange={(e) =>
                          updatePipeline(t.id!, {
                            photoMessage: e.target.value,
                          })
                        }
                        placeholder="Ex: Para que o Dr. possa te dar uma recomendação personalizada, você poderia nos enviar uma foto do seu sorriso?"
                        rows={2}
                        style={{ ...inputStyle, resize: "vertical" }}
                      />
                    </div>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        cursor: "pointer",
                        fontSize: "13px",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={cfg.photoRequired}
                        onChange={(e) =>
                          updatePipeline(t.id!, {
                            photoRequired: e.target.checked,
                          })
                        }
                        style={{ width: "16px", height: "16px" }}
                      />
                      Foto obrigatória — bloqueia agendamento até receber
                    </label>
                  </ToggleCard>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StepPolitica({
  data,
  onChange,
}: {
  data: WizardInitial["policy"];
  onChange: (d: WizardInitial["policy"]) => void;
}) {
  const RULE_PROMPTS = [
    "O que a IA deve SEMPRE fazer que uma recepcionista humana sempre faria?",
    "O que a IA NUNCA deve fazer ou prometer?",
    "Há situações especiais que a IA deve encaminhar para a equipe?",
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div>
        <SectionTitle>Comercial e cobrança</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <FieldLabel>Plano comercial</FieldLabel>
            <select
              value={data.plan}
              onChange={(e) =>
                onChange({ ...data, plan: e.target.value as OrgPlan })
              }
              style={inputStyle}
            >
              <option value="custom">Customizado / ainda definindo</option>
              <option value="essencial">Essencial</option>
              <option value="avancado">Growth</option>
              <option value="rede">Rede</option>
            </select>
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            <input
              type="checkbox"
              checked={data.billingActive}
              onChange={(e) =>
                onChange({ ...data, billingActive: e.target.checked })
              }
              style={{ width: "16px", height: "16px" }}
            />
            Cobrança ativa nesta organização
          </label>
          {data.billingActive && (
            <>
              <div>
                <FieldLabel>Valor mensal contratado (R$)</FieldLabel>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={data.monthlyRevenueBrl}
                  onChange={(e) =>
                    onChange({ ...data, monthlyRevenueBrl: e.target.value })
                  }
                  placeholder="1497"
                  style={inputStyle}
                />
              </div>
              <div>
                <FieldLabel>Início da cobrança</FieldLabel>
                <input
                  type="date"
                  value={data.billingStartedAt}
                  onChange={(e) =>
                    onChange({ ...data, billingStartedAt: e.target.value })
                  }
                  style={inputStyle}
                />
              </div>
            </>
          )}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            <input
              type="checkbox"
              checked={data.isTest}
              onChange={(e) => onChange({ ...data, isTest: e.target.checked })}
              style={{ width: "16px", height: "16px" }}
            />
            Organização em ambiente de testes
          </label>
        </div>
      </div>

      <div>
        <SectionTitle>Política comercial</SectionTitle>
        <p
          style={{
            fontSize: "12px",
            color: "var(--muted)",
            marginBottom: "10px",
          }}
        >
          Valores, formas de pagamento, planos de saúde, promoções. A IA usa
          este texto para responder perguntas sobre preços.
        </p>
        <textarea
          value={data.commercialPolicy}
          onChange={(e) =>
            onChange({ ...data, commercialPolicy: e.target.value })
          }
          placeholder={`Avaliação inicial: gratuita.\nLentes de resina: a partir de R$2.800 o sorriso completo.\nImplante unitário: a partir de R$3.500.\nParcelamento: até 12x no cartão.\nPlanos aceitos: Amil, Bradesco Saúde.`}
          rows={7}
          style={{
            ...inputStyle,
            resize: "vertical",
            fontFamily: "monospace",
            fontSize: "13px",
          }}
        />
      </div>

      <div>
        <SectionTitle>Regras de comportamento da IA</SectionTitle>
        <p
          style={{
            fontSize: "12px",
            color: "var(--muted)",
            marginBottom: "8px",
          }}
        >
          Use os formatos <strong>SEMPRE</strong>, <strong>NUNCA</strong> e{" "}
          <strong>SE...ENTÃO</strong>.
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginBottom: "10px",
          }}
        >
          {RULE_PROMPTS.map((prompt, i) => (
            <div
              key={i}
              style={{
                padding: "10px 14px",
                background: "rgba(0,212,170,0.04)",
                border: "1px solid rgba(0,212,170,0.12)",
                borderRadius: "8px",
                fontSize: "12px",
                color: "var(--muted)",
              }}
            >
              💡 {prompt}
            </div>
          ))}
        </div>
        <textarea
          value={data.notes}
          onChange={(e) => onChange({ ...data, notes: e.target.value })}
          placeholder={`SEMPRE mencione que a avaliação inicial é gratuita.\nSEMPRE informe o endereço ao confirmar agendamento.\nNUNCA prometa desconto sem confirmar com a equipe.\nSE o lead mencionar medo de dor, ENTÃO explique a técnica de anestesia sem dor.`}
          rows={6}
          style={{
            ...inputStyle,
            resize: "vertical",
            fontFamily: "monospace",
            fontSize: "13px",
          }}
        />
      </div>
    </div>
  );
}

function BlueprintPreviewCard({ blueprint }: { blueprint: ClinicBlueprint }) {
  const accent =
    blueprint.status === "complete"
      ? "#34d399"
      : blueprint.status === "attention"
        ? "#f59e0b"
        : "#818cf8";

  return (
    <div
      style={{
        marginBottom: "20px",
        padding: "14px 16px",
        borderRadius: "12px",
        border: `1px solid ${accent}33`,
        background: `${accent}0d`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: accent,
            }}
          >
            Clinic Blueprint
          </p>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: "13px",
              color: "var(--muted)",
            }}
          >
            Prontidão atual para implantação e go-live.
          </p>
        </div>
        <div style={{ fontSize: "24px", fontWeight: 700, color: accent }}>
          {blueprint.readinessPercent}%
        </div>
      </div>
      {blueprint.criticalMissing.length > 0 && (
        <div style={{ marginTop: "12px", display: "grid", gap: "6px" }}>
          {blueprint.criticalMissing.slice(0, 3).map((item) => (
            <span
              key={item}
              style={{ fontSize: "12px", color: "var(--muted)" }}
            >
              • {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StepRevisao({
  clinicName,
  identity,
  channel,
  receptionist,
  schedule,
  treatments,
  pipelines,
  policy,
  blueprint,
}: {
  clinicName: string;
  identity: WizardInitial["identity"];
  channel: WizardInitial["channel"];
  receptionist: WizardInitial["receptionist"];
  schedule: WizardInitial["schedule"];
  treatments: WizardTreatment[];
  pipelines: PipelineConfig[];
  policy: WizardInitial["policy"];
  blueprint: ClinicBlueprint;
}) {
  const items: { label: string; value: string; ok: boolean }[] = [
    { label: "Organização", value: clinicName, ok: true },
    {
      label: "Categoria",
      value: identity.specialty,
      ok: !!identity.specialty,
    },
    { label: "Cidade", value: identity.city || "—", ok: !!identity.city },
    { label: "Endereço", value: identity.address, ok: !!identity.address },
    {
      label: "Canal",
      value: channel.provider === "z_api" ? "Z-API" : "Meta Cloud API",
      ok:
        channel.provider === "z_api"
          ? !!channel.zapiInstanceId && !!channel.zapiToken
          : !!channel.metaPhoneNumberId && !!channel.metaAccessToken,
    },
    {
      label: "Boas-vindas",
      value: identity.greetingMessage ? "✓ Configurada" : "—",
      ok: !!identity.greetingMessage,
    },
    { label: "Tom de voz", value: receptionist.toneOfVoice, ok: true },
    {
      label: "Diferenciais",
      value: `${receptionist.differentials.filter(Boolean).length} configurados`,
      ok: receptionist.differentials.filter(Boolean).length > 0,
    },
    {
      label: "Horários",
      value: schedule.businessHours,
      ok: !!schedule.businessHours,
    },
    {
      label: "Recepção humana",
      value: schedule.receptionistPhone || "—",
      ok: !!schedule.receptionistPhone,
    },
    {
      label: "Agenda",
      value:
        schedule.calendarMode === "google_calendar"
          ? "Google Calendar"
          : "Agenda interna",
      ok:
        schedule.calendarMode === "google_calendar"
          ? !!schedule.googleCalendarId
          : true,
    },
    {
      label: "Procedimentos",
      value: `${treatments.length} cadastrados`,
      ok: treatments.length > 0,
    },
    {
      label: "Jornadas ativas",
      value: `${pipelines.filter((p) => p.enabled).length} de ${pipelines.length}`,
      ok: true,
    },
    { label: "Plano", value: policy.plan, ok: policy.plan !== "custom" },
    {
      label: "Cobrança",
      value: policy.billingActive
        ? `R$ ${policy.monthlyRevenueBrl || "0"}/mês`
        : "Ainda não ativada",
      ok: !policy.billingActive || !!policy.monthlyRevenueBrl,
    },
    {
      label: "Ambiente",
      value: policy.isTest ? "Teste" : "Produção",
      ok: true,
    },
    {
      label: "Política comercial",
      value: policy.commercialPolicy ? "✓ Preenchida" : "⚠ Vazia",
      ok: !!policy.commercialPolicy,
    },
    {
      label: "Regras da IA",
      value: policy.notes ? "✓ Preenchidas" : "— Não configuradas",
      ok: !!policy.notes,
    },
  ];

  const issues = items.filter((item) => !item.ok);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {issues.length > 0 && (
        <div
          style={{
            padding: "12px 16px",
            background: "rgba(251,191,36,0.08)",
            border: "1px solid rgba(251,191,36,0.2)",
            borderRadius: "10px",
            display: "flex",
            gap: "10px",
          }}
        >
          <AlertCircle
            size={16}
            strokeWidth={2}
            style={{ color: "#fbbf24", flexShrink: 0, marginTop: "2px" }}
          />
          <div>
            <p
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#fbbf24",
                marginBottom: "4px",
              }}
            >
              Campos incompletos
            </p>
            <p style={{ fontSize: "12px", color: "var(--muted)" }}>
              {issues.map((i) => i.label).join(", ")} — você pode completar
              depois em Configurações.
            </p>
          </div>
        </div>
      )}

      <div
        style={{
          padding: "14px 16px",
          background: "rgba(0,212,170,0.05)",
          border: "1px solid rgba(0,212,170,0.16)",
          borderRadius: "12px",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--accent)",
          }}
        >
          Blueprint de implantação
        </p>
        <div style={{ marginTop: "8px", fontSize: "24px", fontWeight: 700 }}>
          {blueprint.readinessPercent}%
        </div>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: "13px",
            color: "var(--muted)",
            lineHeight: 1.5,
          }}
        >
          {blueprint.criticalMissing.length === 0
            ? "Todos os blocos críticos já estão preenchidos."
            : `Ainda faltam ${blueprint.criticalMissing.length} ponto(s) críticos para fechar o go-live.`}
        </p>
      </div>

      <div
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        {items.map((item, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "11px 16px",
              borderBottom:
                i < items.length - 1
                  ? "1px solid rgba(255,255,255,0.05)"
                  : "none",
              background:
                i % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent",
            }}
          >
            <span style={{ fontSize: "13px", color: "var(--muted)" }}>
              {item.label}
            </span>
            <span
              style={{
                fontSize: "13px",
                fontWeight: 500,
                color: item.ok ? "var(--foreground)" : "#fbbf24",
                textAlign: "right",
                maxWidth: "60%",
              }}
            >
              {item.value}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          padding: "14px 16px",
          background: "rgba(0,212,170,0.06)",
          border: "1px solid rgba(0,212,170,0.2)",
          borderRadius: "12px",
          fontSize: "13px",
        }}
      >
        <p
          style={{
            fontWeight: 600,
            color: "var(--accent)",
            marginBottom: "4px",
          }}
        >
          Pronto para ativar
        </p>
        <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
          Ao concluir, o resumo do blueprint ficará disponível no painel owner.
          Você pode ajustar qualquer detalhe a qualquer momento em{" "}
          <strong style={{ color: "var(--foreground)" }}>Configurações</strong>,{" "}
          <strong style={{ color: "var(--foreground)" }}>Onboarding</strong> e{" "}
          <strong style={{ color: "var(--foreground)" }}>Pipeline</strong>.
        </p>
      </div>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export function OnboardingWizardClient({
  clinicId,
  clinicName,
  initial,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [identity, setIdentity] = useState(initial.identity);
  const [receptionist, setReceptionist] = useState(initial.receptionist);
  const [schedule, setSchedule] = useState(initial.schedule);
  const [channel, setChannel] = useState(initial.channel);
  const [treatmentList, setTreatmentList] = useState<WizardTreatment[]>(
    initial.treatments,
  );
  const [pipelines, setPipelines] = useState<PipelineConfig[]>(
    initial.treatments
      .filter((t) => t.isAesthetic && t.id)
      .map(initPipelineConfig),
  );
  const [policy, setPolicy] = useState(initial.policy);

  const blueprint = buildClinicBlueprint({
    clinic: {
      specialty: identity.specialty,
      city: identity.city,
      address: identity.address,
      greetingMessage: identity.greetingMessage,
      businessHours: schedule.businessHours,
      calendarMode: schedule.calendarMode,
      googleCalendarId: schedule.googleCalendarId,
      receptionistPhone: schedule.receptionistPhone,
      autoReplyEnabled: initial.autoReplyEnabled,
      isTest: policy.isTest,
      plan: policy.plan,
      monthlyRevenueBrl:
        policy.billingActive && policy.monthlyRevenueBrl
          ? Number(policy.monthlyRevenueBrl) * 100
          : 0,
      billingStartedAt: policy.billingStartedAt
        ? new Date(policy.billingStartedAt)
        : null,
      defaultAppointmentDurationMinutes: schedule.defaultDurationMinutes,
      postAppointmentBufferMinutes: schedule.bufferMinutes,
      takeoverTtlHours: schedule.takeoverTtlHours,
      channelProvider: channel.provider,
      zapiInstanceId: channel.zapiInstanceId,
      zapiToken: channel.zapiToken,
      metaPhoneNumberId: channel.metaPhoneNumberId,
      metaAccessToken: channel.metaAccessToken,
    },
    playbook: {
      toneOfVoice: receptionist.toneOfVoice,
      commercialPolicy: policy.commercialPolicy,
      notes: policy.notes,
      differentialsCount: receptionist.differentials.filter(Boolean).length,
      mediaLibraryCount: initial.mediaLibrary.length,
      objectionsCount: 0,
    },
    treatments: treatmentList.map((t) => ({
      pipelineStepsCount: pipelines.find(
        (pipeline) => pipeline.treatmentId === t.id,
      )?.enabled
        ? toPipelineSteps(
            pipelines.find((pipeline) => pipeline.treatmentId === t.id)!,
          ).length
        : (t.pipelineSteps?.length ?? 0),
    })),
  });

  // Keep pipelines in sync when aesthetic treatments change
  function syncPipelines(newTreatments: WizardTreatment[]) {
    setTreatmentList(newTreatments);
    const aesthetic = newTreatments.filter((t) => t.isAesthetic && t.id);
    setPipelines((prev) => {
      const map = new Map(prev.map((p) => [p.treatmentId, p]));
      return aesthetic.map((t) => map.get(t.id!) ?? initPipelineConfig(t));
    });
  }

  async function handleNext() {
    setError(null);
    let result: { success: boolean; error?: string } = { success: true };

    await new Promise<void>((resolve) =>
      startTransition(async () => {
        switch (step) {
          case 1:
            result = await saveWizardIdentity(clinicId, {
              ...identity,
              channelProvider: channel.provider,
              zapiInstanceId: channel.zapiInstanceId,
              zapiToken: channel.zapiToken,
              zapiClientToken: channel.zapiClientToken,
              metaPhoneNumberId: channel.metaPhoneNumberId,
              metaAccessToken: channel.metaAccessToken,
            });
            break;
          case 2:
            result = await saveWizardReceptionist(clinicId, receptionist);
            break;
          case 3:
            result = await saveWizardSchedule(clinicId, {
              businessHours: schedule.businessHours,
              calendarMode: schedule.calendarMode,
              googleCalendarId: schedule.googleCalendarId,
              receptionistPhone: schedule.receptionistPhone,
              defaultAppointmentDurationMinutes:
                schedule.defaultDurationMinutes,
              postAppointmentBufferMinutes: schedule.bufferMinutes,
              takeoverTtlHours: schedule.takeoverTtlHours,
            });
            break;
          case 4: {
            const res = await saveWizardTreatments(clinicId, treatmentList);
            result = res;
            if (res.success && res.savedIds.length > 0) {
              const updated = treatmentList.map((t) => {
                if (t.id) return t;
                const found = res.savedIds.find((s) => s.tempKey === t.name);
                return found ? { ...t, id: found.id } : t;
              });
              syncPipelines(updated);
            }
            break;
          }
          case 5: {
            const toSave = pipelines.map((cfg) => ({
              treatmentId: cfg.treatmentId,
              steps: toPipelineSteps(cfg),
            }));
            result = await saveWizardPipelines(toSave);
            break;
          }
          case 6:
            result = await saveWizardPolicy(clinicId, {
              commercialPolicy: policy.commercialPolicy,
              notes: policy.notes,
              plan: policy.plan,
              billingActive: policy.billingActive,
              monthlyRevenueBrl: policy.monthlyRevenueBrl
                ? Number(policy.monthlyRevenueBrl)
                : undefined,
              billingStartedAt: policy.billingStartedAt || undefined,
              isTest: policy.isTest,
            });
            break;
          case 7:
            setDone(true);
            setTimeout(() => router.push(`/owner/clinics/${clinicId}`), 1200);
            return resolve();
        }

        if (result.success) {
          setStep((s) => Math.min(s + 1, 7));
        } else {
          setError(result.error ?? "Erro ao salvar");
        }
        resolve();
      }),
    );
  }

  const currentStep = STEPS[step - 1];
  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--background)",
      }}
    >
      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--background)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          padding: "0",
        }}
      >
        {/* Progress bar */}
        <div style={{ height: "3px", background: "rgba(255,255,255,0.06)" }}>
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: "var(--accent)",
              transition: "width 0.4s ease",
            }}
          />
        </div>

        <div
          style={{
            padding: "16px 20px",
            maxWidth: "680px",
            margin: "0 auto",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "rgba(0,212,170,0.1)",
                border: "1px solid rgba(0,212,170,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <currentStep.Icon
                size={16}
                strokeWidth={2}
                style={{ color: "var(--accent)" }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--muted)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                Passo {step} de {STEPS.length} · {clinicName}
              </div>
              <div
                style={{ fontSize: "16px", fontWeight: 700, marginTop: "1px" }}
              >
                {currentStep.title}
              </div>
            </div>
            {/* Step dots */}
            <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
              {STEPS.map((s) => (
                <div
                  key={s.id}
                  style={{
                    width: s.id === step ? "18px" : "6px",
                    height: "6px",
                    borderRadius: "3px",
                    background:
                      s.id < step
                        ? "var(--accent)"
                        : s.id === step
                          ? "var(--accent)"
                          : "rgba(255,255,255,0.15)",
                    transition: "all 0.3s",
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 20px",
          maxWidth: "680px",
          margin: "0 auto",
          width: "100%",
        }}
      >
        <p
          style={{
            fontSize: "13px",
            color: "var(--muted)",
            marginBottom: "24px",
          }}
        >
          {currentStep.subtitle}
        </p>
        <BlueprintPreviewCard blueprint={blueprint} />

        {step === 1 && (
          <StepIdentidade
            data={identity}
            channel={channel}
            onChange={setIdentity}
            onChannelChange={setChannel}
            clinicId={clinicId}
          />
        )}
        {step === 2 && (
          <StepRecepcionista data={receptionist} onChange={setReceptionist} />
        )}
        {step === 3 && <StepHorarios data={schedule} onChange={setSchedule} />}
        {step === 4 && (
          <StepProcedimentos data={treatmentList} onChange={syncPipelines} />
        )}
        {step === 5 && (
          <StepJornada
            treatments={treatmentList}
            pipelines={pipelines}
            onChange={setPipelines}
            mediaLibrary={initial.mediaLibrary}
          />
        )}
        {step === 6 && <StepPolitica data={policy} onChange={setPolicy} />}
        {step === 7 && (
          <>
            <StepRevisao
              clinicName={clinicName}
              identity={identity}
              channel={channel}
              receptionist={receptionist}
              schedule={schedule}
              treatments={treatmentList}
              pipelines={pipelines}
              policy={policy}
              blueprint={blueprint}
            />
            <a
              href={`/owner/clinics/${clinicId}/blueprint`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 16,
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid rgba(16,185,129,0.22)",
                background: "rgba(16,185,129,0.05)",
                textDecoration: "none",
                color: "#10b981",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <span>Ver Blueprint completo em modo apresentação</span>
              <ChevronRight size={16} />
            </a>
          </>
        )}

        {error && (
          <div
            style={{
              marginTop: "16px",
              padding: "10px 14px",
              background: "rgba(248,113,113,0.1)",
              border: "1px solid rgba(248,113,113,0.25)",
              borderRadius: "8px",
              color: "#f87171",
              fontSize: "13px",
              display: "flex",
              gap: "8px",
              alignItems: "center",
            }}
          >
            <AlertCircle size={14} strokeWidth={2} />
            {error}
          </div>
        )}

        {/* Bottom padding for mobile nav */}
        <div style={{ height: "80px" }} />
      </div>

      {/* Footer nav */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: "var(--background)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          padding: "16px 20px",
        }}
      >
        <div
          style={{
            maxWidth: "680px",
            margin: "0 auto",
            display: "flex",
            gap: "10px",
          }}
        >
          {step > 1 && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep((s) => s - 1);
              }}
              disabled={isPending}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "14px 20px",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.1)",
                background: "transparent",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              <ChevronLeft size={16} strokeWidth={2.5} />
              Voltar
            </button>
          )}

          <button
            type="button"
            onClick={handleNext}
            disabled={isPending || done}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              padding: "14px 20px",
              borderRadius: "12px",
              border: "none",
              background: done ? "rgba(0,212,170,0.8)" : "var(--accent)",
              color: "#000",
              cursor: isPending || done ? "not-allowed" : "pointer",
              fontSize: "15px",
              fontWeight: 700,
              transition: "all 0.15s",
              opacity: isPending ? 0.8 : 1,
            }}
          >
            {isPending ? (
              <>
                <Loader2
                  size={16}
                  strokeWidth={2.5}
                  style={{ animation: "spin 1s linear infinite" }}
                />{" "}
                Salvando...
              </>
            ) : done ? (
              <>
                <CheckCircle2 size={16} strokeWidth={2.5} /> Concluído!
              </>
            ) : step === 7 ? (
              <>
                <CheckCircle2 size={16} strokeWidth={2.5} /> Concluir onboarding
              </>
            ) : (
              <>
                Próximo <ChevronRight size={16} strokeWidth={2.5} />
              </>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ─── Style helpers ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.04)",
  color: "var(--foreground)",
  fontSize: "14px",
  outline: "none",
  margin: 0,
};

const iconBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "8px",
  padding: "8px",
  cursor: "pointer",
  color: "var(--muted)",
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
};

const addBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  padding: "12px",
  borderRadius: "10px",
  border: "1px dashed rgba(0,212,170,0.3)",
  background: "rgba(0,212,170,0.04)",
  color: "var(--accent)",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 600,
  width: "100%",
};
