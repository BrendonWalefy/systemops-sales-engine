export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Lock, Settings2 } from "lucide-react";
import { db } from "@/infrastructure/db/client";
import { clinics, clinicModules } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { MODULE_CATALOG } from "@/application/modules/module-catalog";
import type { ModuleKey } from "@/application/modules/module-catalog";
import type { ClinicPlan } from "@/application/onboarding/clinic-commercial-settings";
import type { VoiceTtsConfig, VoiceElevenLabsConfig } from "@/application/modules/module-configs";
import { VOICE_MODE_LABELS, type VoiceMode } from "@/domain/entities/voice-mode";
import { toggleModule, syncPlanModules, updateModuleConfig } from "./actions";

async function getData(clinicId: string) {
  const [clinic, moduleRows] = await Promise.all([
    db
      .select({ id: clinics.id, name: clinics.name, plan: clinics.plan })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        moduleKey: clinicModules.moduleKey,
        isActive: clinicModules.isActive,
        config: clinicModules.config,
        updatedAt: clinicModules.updatedAt,
        updatedBy: clinicModules.updatedBy,
      })
      .from(clinicModules)
      .where(eq(clinicModules.clinicId, clinicId)),
  ]);
  return { clinic, moduleRows };
}

export default async function ClinicModulesPage({
  params,
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const { clinicId } = await params;
  const { clinic, moduleRows } = await getData(clinicId);
  if (!clinic) notFound();

  const plan = clinic.plan as ClinicPlan;
  const moduleMap = new Map(moduleRows.map((r) => [r.moduleKey, r]));

  return (
    <div style={{ maxWidth: "680px", margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <Link
          href={`/owner/clinics/${clinicId}`}
          style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#71717a", textDecoration: "none", marginBottom: "12px" }}
        >
          <ArrowLeft size={14} /> Voltar para a clínica
        </Link>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#fafafa" }}>{clinic.name} — Módulos</h1>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#71717a" }}>
              Plano: <span style={{ color: "#34d399", fontWeight: 600, textTransform: "capitalize" }}>{plan}</span>
              <span style={{ color: "#3f3f46", marginLeft: "8px" }}>· Como owner, você pode ativar qualquer módulo independente do plano.</span>
            </p>
          </div>
          <form
            action={async () => {
              "use server";
              await syncPlanModules(clinicId, plan);
            }}
          >
            <button
              type="submit"
              style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#fafafa", fontSize: "13px", cursor: "pointer" }}
            >
              Sincronizar com plano
            </button>
          </form>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {MODULE_CATALOG.map((def) => {
          const row = moduleMap.get(def.key);
          const isActive = row?.isActive ?? false;
          const inPlan = def.plans.includes(plan);
          const config = row?.config ?? null;

          const voiceTtsConfig = def.key === "voice_tts" ? (config as VoiceTtsConfig | null) : null;
          const elevenLabsConfig = def.key === "voice_elevenlabs" ? (config as VoiceElevenLabsConfig | null) : null;
          const hasConfigPanel = isActive && (def.key === "voice_tts" || def.key === "voice_elevenlabs");

          return (
            <div
              key={def.key}
              style={{
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.07)",
                background: isActive ? "rgba(16,185,129,0.04)" : "rgba(255,255,255,0.02)",
                overflow: "hidden",
              }}
            >
              {/* Module row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "16px",
                  padding: "14px 16px",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>{def.label}</span>
                    <span style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: "4px",
                      ...(isActive
                        ? { background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" }
                        : { background: "rgba(255,255,255,0.05)", color: "#52525b", border: "1px solid rgba(255,255,255,0.07)" }),
                    }}>
                      {isActive ? "Ativo" : "Inativo"}
                    </span>
                    {!inPlan && (
                      <span style={{ fontSize: "10px", color: "#52525b", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                        <Lock size={10} /> fora do plano atual
                      </span>
                    )}
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: "12px", color: "#52525b" }}>{def.description}</p>
                </div>

                <form
                  action={async () => {
                    "use server";
                    await toggleModule(clinicId, def.key as ModuleKey, !isActive);
                  }}
                >
                  <button
                    type="submit"
                    style={{
                      width: "44px",
                      height: "24px",
                      borderRadius: "12px",
                      border: "none",
                      background: isActive ? "#10b981" : "rgba(255,255,255,0.1)",
                      cursor: "pointer",
                      position: "relative",
                      transition: "background 200ms",
                      flexShrink: 0,
                    }}
                  >
                    <span style={{
                      position: "absolute",
                      top: "3px",
                      left: isActive ? "23px" : "3px",
                      width: "18px",
                      height: "18px",
                      borderRadius: "50%",
                      background: "#fff",
                      transition: "left 200ms",
                    }} />
                  </button>
                </form>
              </div>

              {/* Config panel — voice_tts */}
              {hasConfigPanel && def.key === "voice_tts" && (
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    const provider = String(formData.get("provider") ?? "nova");
                    const speed = provider === "neural2" ? 1.0 : 0.92;
                    await updateModuleConfig(clinicId, "voice_tts", { provider, speed });
                  }}
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    padding: "14px 16px",
                    background: "rgba(255,255,255,0.015)",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <Settings2 size={14} style={{ color: "#52525b", flexShrink: 0 }} />
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <label style={{ fontSize: "12px", color: "#71717a" }}>Provedor de voz</label>
                    <select
                      name="provider"
                      defaultValue={voiceTtsConfig?.provider ?? "nova"}
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "6px",
                        color: "#fafafa",
                        fontSize: "12px",
                        padding: "4px 8px",
                        cursor: "pointer",
                      }}
                    >
                      <option value="nova">OpenAI Nova (feminina, calorosa)</option>
                      <option value="neural2">Google Neural2 (PT-BR nativa)</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    style={{
                      padding: "5px 12px",
                      borderRadius: "6px",
                      border: "1px solid rgba(16,185,129,0.3)",
                      background: "rgba(16,185,129,0.08)",
                      color: "#34d399",
                      fontSize: "12px",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Salvar
                  </button>
                </form>
              )}

              {/* Config panel — B-WAVE Voice */}
              {hasConfigPanel && def.key === "voice_elevenlabs" && (
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    const voiceId = String(formData.get("voiceId") ?? "").trim();
                    const stability = Math.min(1, Math.max(0, parseFloat(String(formData.get("stability") ?? "0.5"))));
                    const similarityBoost = Math.min(1, Math.max(0, parseFloat(String(formData.get("similarityBoost") ?? "0.75"))));
                    const speed = Math.min(1.2, Math.max(0.7, parseFloat(String(formData.get("speed") ?? "1.0"))));
                    const mode = (String(formData.get("mode") ?? "impact")) as VoiceMode;
                    await updateModuleConfig(clinicId, "voice_elevenlabs", { voiceId, stability, similarityBoost, speed, mode });
                  }}
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    padding: "14px 16px",
                    background: "rgba(255,255,255,0.015)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <Settings2 size={14} style={{ color: "#52525b" }} />
                    <span style={{ fontSize: "12px", color: "#71717a", fontWeight: 600 }}>B-WAVE — Configuração</span>
                    {!elevenLabsConfig?.voiceId && (
                      <span style={{ fontSize: "10px", color: "#f59e0b", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "4px", padding: "1px 6px" }}>
                        Voice ID pendente
                      </span>
                    )}
                  </div>

                  {/* Voice ID */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "11px", color: "#52525b" }}>
                      Voice ID <span style={{ color: "#3f3f46" }}>(ElevenLabs → My Voices → copie o ID)</span>
                    </label>
                    <input
                      name="voiceId"
                      defaultValue={elevenLabsConfig?.voiceId ?? ""}
                      placeholder="ex: GM2UA3fbsIaLHcswCDX9"
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        border: !elevenLabsConfig?.voiceId ? "1px solid rgba(245,158,11,0.4)" : "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "6px", color: "#fafafa", fontSize: "12px",
                        padding: "6px 10px", fontFamily: "monospace", width: "100%", boxSizing: "border-box",
                      }}
                    />
                  </div>

                  {/* Modo B-WAVE */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "11px", color: "#52525b" }}>Modo de operação</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {(["impact", "mix", "full"] as VoiceMode[]).map((m) => (
                        <label key={m} style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "8px 10px", borderRadius: "6px", background: (elevenLabsConfig?.mode ?? "impact") === m ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.03)", border: (elevenLabsConfig?.mode ?? "impact") === m ? "1px solid rgba(16,185,129,0.2)" : "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}>
                          <input type="radio" name="mode" value={m} defaultChecked={(elevenLabsConfig?.mode ?? "impact") === m} style={{ marginTop: "2px", accentColor: "#10b981" }} />
                          <div>
                            <div style={{ fontSize: "12px", fontWeight: 600, color: "#fafafa" }}>{VOICE_MODE_LABELS[m].label}</div>
                            <div style={{ fontSize: "11px", color: "#52525b", marginTop: "1px" }}>{VOICE_MODE_LABELS[m].description}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Ajustes técnicos */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <label style={{ fontSize: "11px", color: "#52525b" }}>Stability (0–1)</label>
                      <input name="stability" type="number" min="0" max="1" step="0.05" defaultValue={elevenLabsConfig?.stability ?? 0.5}
                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "#fafafa", fontSize: "12px", padding: "6px 10px", width: "100%", boxSizing: "border-box" }} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <label style={{ fontSize: "11px", color: "#52525b" }}>Similarity Boost (0–1)</label>
                      <input name="similarityBoost" type="number" min="0" max="1" step="0.05" defaultValue={elevenLabsConfig?.similarityBoost ?? 0.75}
                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "#fafafa", fontSize: "12px", padding: "6px 10px", width: "100%", boxSizing: "border-box" }} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <label style={{ fontSize: "11px", color: "#52525b" }}>Velocidade (0.7–1.2)</label>
                      <input name="speed" type="number" min="0.7" max="1.2" step="0.05" defaultValue={elevenLabsConfig?.speed ?? 1.0}
                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "#fafafa", fontSize: "12px", padding: "6px 10px", width: "100%", boxSizing: "border-box" }} />
                    </div>
                  </div>

                  <button
                    type="submit"
                    style={{
                      padding: "7px 16px", borderRadius: "6px",
                      border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.08)",
                      color: "#34d399", fontSize: "12px", cursor: "pointer", fontWeight: 600, alignSelf: "flex-start",
                    }}
                  >
                    Salvar configuração B-WAVE
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
