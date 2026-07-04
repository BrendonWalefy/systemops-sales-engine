"use client";
import { useState, useTransition } from "react";
import { Mic, Lock } from "lucide-react";
import { toggleVoiceOutput, updateVoiceModuleConfig, updateBWaveConfig, updateBWaveSpeed } from "./playbook-version-actions";
import { VOICE_MODE_LABELS, type VoiceMode } from "@/domain/entities/voice-mode";
import type { VoiceElevenLabsConfig, VoiceTtsConfig } from "@/application/modules/module-configs";
import { TTS_SPEED_DEFAULTS } from "@/domain/entities/tts-config";
import type { TtsProvider } from "@/domain/entities/tts-config";
import { S, SettingsCard, SettingsToggle, SettingsBadge, CollapsibleAdvanced, IconBox, SLabel } from "./settings-primitives";

type ActiveModule = { key: string; config?: Record<string, unknown> | null };
type ClinicData = { activeModules: ActiveModule[] };

export function TabVoz({ clinic }: { clinic: ClinicData }) {
  const voiceMod = clinic.activeModules.find((m) => m.key === "voice_tts");
  const voiceModuleActive = !!voiceMod;
  const bwaveMod = clinic.activeModules.find((m) => m.key === "voice_elevenlabs");
  const bwaveActive = !!bwaveMod;
  const bwaveConfig = bwaveMod?.config as VoiceElevenLabsConfig | null | undefined;
  const bwaveMode: VoiceMode = bwaveConfig?.mode ?? "impact";

  const bwaveOutputEnabledInit = bwaveConfig?.voiceOutputEnabled !== false;
  const ttsOutputEnabledInit = (voiceMod?.config as { voiceOutputEnabled?: boolean } | null)?.voiceOutputEnabled !== false;

  const [bwaveOutputEnabled, setBwaveOutputEnabled] = useState(bwaveOutputEnabledInit);
  const [bwaveOutputPending, setBwaveOutputPending] = useState(false);
  const [ttsOutputEnabled, setTtsOutputEnabled] = useState(ttsOutputEnabledInit);
  const [ttsOutputPending, setTtsOutputPending] = useState(false);

  const [ttsConfig, setTtsConfig] = useState<VoiceTtsConfig>(
    voiceMod?.config
      ? {
          provider: (voiceMod.config.provider as TtsProvider) ?? "nova",
          speed: Number(voiceMod.config.speed ?? 1.0),
          mode: (voiceMod.config.mode as VoiceMode) ?? "impact",
        }
      : { provider: "nova", speed: TTS_SPEED_DEFAULTS.nova, mode: "impact" },
  );
  const [ttsConfigPending, startTtsConfigTransition] = useTransition();

  const [bwaveDraft, setBwaveDraft] = useState<VoiceElevenLabsConfig>({
    voiceId: bwaveConfig?.voiceId ?? "",
    stability: bwaveConfig?.stability ?? 0.5,
    similarityBoost: bwaveConfig?.similarityBoost ?? 0.75,
    speed: bwaveConfig?.speed ?? 1.0,
    mode: bwaveConfig?.mode ?? "impact",
  });
  const [bwaveSpeed, setBwaveSpeed] = useState(bwaveConfig?.speed ?? 1.0);
  const [bwaveSpeedPending, startBwaveSpeedTransition] = useTransition();
  const [bwaveConfigPending, startBwaveConfigTransition] = useTransition();

  async function handleTtsOutputToggle() {
    if (ttsOutputPending) return;
    const previous = ttsOutputEnabled;
    const next = !previous;
    setTtsOutputEnabled(next);
    setTtsOutputPending(true);
    try {
      await toggleVoiceOutput("voice_tts", next);
    } catch (error) {
      setTtsOutputEnabled(previous);
      console.error("[settings-voice] Failed to toggle TTS output:", error);
    } finally {
      setTtsOutputPending(false);
    }
  }

  async function handleBwaveOutputToggle() {
    if (bwaveOutputPending) return;
    const previous = bwaveOutputEnabled;
    const next = !previous;
    setBwaveOutputEnabled(next);
    setBwaveOutputPending(true);
    try {
      await toggleVoiceOutput("voice_elevenlabs", next);
    } catch (error) {
      setBwaveOutputEnabled(previous);
      console.error("[settings-voice] Failed to toggle B-WAVE output:", error);
    } finally {
      setBwaveOutputPending(false);
    }
  }

  function handleTtsProviderChange(provider: TtsProvider) {
    const next: VoiceTtsConfig = { ...ttsConfig, provider, speed: TTS_SPEED_DEFAULTS[provider] };
    setTtsConfig(next);
    startTtsConfigTransition(async () => { await updateVoiceModuleConfig(next); });
  }

  function handleTtsSpeedChange(speed: number) {
    const next: VoiceTtsConfig = { ...ttsConfig, speed };
    setTtsConfig(next);
    startTtsConfigTransition(async () => { await updateVoiceModuleConfig(next); });
  }

  function handleTtsModeChange(mode: VoiceMode) {
    const next: VoiceTtsConfig = { ...ttsConfig, mode };
    setTtsConfig(next);
    startTtsConfigTransition(async () => { await updateVoiceModuleConfig(next); });
  }

  function handleBwaveSpeedChange(speed: number) {
    setBwaveSpeed(speed);
    setBwaveDraft((c) => ({ ...c, speed }));
    startBwaveSpeedTransition(async () => { await updateBWaveSpeed(speed); });
  }

  function handleSaveBwaveConfig() {
    startBwaveConfigTransition(async () => { await updateBWaveConfig(bwaveDraft); });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: S.sectionGap, maxWidth: "660px" }}>

      {/* Voz Básica (TTS) */}
      <SettingsCard active={voiceModuleActive && ttsOutputEnabled && !bwaveActive}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", paddingBottom: voiceModuleActive && !bwaveActive ? "12px" : "0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
              <IconBox active={voiceModuleActive}>
                <Mic size={15} strokeWidth={1.8} />
              </IconBox>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: S.fs.title, fontWeight: 600, color: S.text }}>Resposta por Voz</strong>
                  <SettingsBadge variant={voiceModuleActive && ttsOutputEnabled ? "active" : "locked"}>
                    {voiceModuleActive && ttsOutputEnabled ? "Ativa" : "Inativa"}
                  </SettingsBadge>
                </div>
                <p style={{ margin: "2px 0 0", fontSize: S.fs.desc, color: S.textSec }}>
                  {bwaveActive
                    ? "Áudio gerenciado pelo B-WAVE Voice abaixo."
                    : voiceModuleActive
                      ? ttsOutputEnabled ? "IA envia áudios de voz em vez de texto." : "Voz instalada · saída pausada (modo texto)."
                      : "Para ativar este módulo, fale com o suporte."}
                </p>
              </div>
            </div>
            {!voiceModuleActive && <Lock size={14} style={{ color: S.textMuted, flexShrink: 0 }} />}
            {voiceModuleActive && !bwaveActive && (
              <SettingsToggle checked={ttsOutputEnabled} onChange={handleTtsOutputToggle} pending={ttsOutputPending} />
            )}
          </div>

          {voiceModuleActive && !bwaveActive && (
            <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <SLabel>Voz</SLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {(([
                    { id: "nova" as TtsProvider, label: "Nova", description: "OpenAI · EN-native", badge: "Padrão" },
                    { id: "neural2" as TtsProvider, label: "Neural2", description: "Google · PT-BR Neural2", badge: "Novo" },
                  ]) as { id: TtsProvider; label: string; description: string; badge: string }[]).map((opt) => {
                    const selected = ttsConfig.provider === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={ttsConfigPending}
                        onClick={() => handleTtsProviderChange(opt.id)}
                        style={{
                          display: "flex", flexDirection: "row", alignItems: "center",
                          justifyContent: "space-between", gap: "8px",
                          padding: "9px 12px", borderRadius: "8px", border: "none", width: "100%",
                          cursor: ttsConfigPending ? "default" : "pointer", textAlign: "left",
                          opacity: ttsConfigPending ? 0.7 : 1, transition: "background 150ms",
                          background: selected ? "rgba(0,224,178,0.08)" : S.card,
                          outline: selected ? `1px solid rgba(0,224,178,0.3)` : `1px solid ${S.border}`,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: selected ? S.teal : S.text }}>{opt.label}</span>
                          <span style={{ fontSize: "11px", color: S.textMuted }}>{opt.description}</span>
                        </div>
                        <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 7px", borderRadius: "4px", background: selected ? "rgba(0,224,178,0.12)" : S.card, color: selected ? S.teal : S.textMuted }}>{opt.badge}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <SLabel>Modo de voz</SLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {(["impact", "mix", "full"] as VoiceMode[]).map((mode) => {
                    const selected = ttsConfig.mode === mode;
                    const isRec = mode === "impact";
                    return (
                      <button
                        key={mode}
                        type="button"
                        disabled={ttsConfigPending}
                        onClick={() => handleTtsModeChange(mode)}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: "10px",
                          padding: "10px 12px", borderRadius: "8px",
                          border: selected ? `1px solid rgba(0,224,178,0.25)` : `1px solid ${S.border}`,
                          background: selected ? S.cardActive : S.card,
                          cursor: ttsConfigPending ? "default" : "pointer", textAlign: "left",
                          opacity: ttsConfigPending ? 0.7 : 1,
                        }}
                      >
                        <span style={{ width: "8px", height: "8px", marginTop: "5px", borderRadius: "999px", background: selected ? S.teal : S.textMuted, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "13px", fontWeight: 600, color: S.text }}>{VOICE_MODE_LABELS[mode].label}</span>
                            {isRec && <SettingsBadge variant="recommended">Recomendado</SettingsBadge>}
                          </div>
                          <div style={{ fontSize: "11px", color: S.textSec, marginTop: "2px" }}>{VOICE_MODE_LABELS[mode].description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <SLabel style={{ margin: 0 }}>Velocidade</SLabel>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: S.teal, fontVariantNumeric: "tabular-nums" }}>
                    {ttsConfig.speed.toFixed(2)}×
                  </span>
                </div>
                <input
                  type="range" min={0.7} max={1.3} step={0.05}
                  value={ttsConfig.speed}
                  disabled={ttsConfigPending}
                  onChange={(e) => handleTtsSpeedChange(Number(e.target.value))}
                  onPointerUp={(e) => handleTtsSpeedChange(Number((e.target as HTMLInputElement).value))}
                  style={{ width: "100%", accentColor: S.teal, cursor: ttsConfigPending ? "default" : "pointer", touchAction: "none" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
                  <span style={{ fontSize: "10px", color: S.textMuted }}>lento</span>
                  <span style={{ fontSize: "10px", color: S.textMuted }}>rápido</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* B-WAVE Voice */}
      <SettingsCard active={bwaveActive}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", paddingBottom: bwaveActive ? "12px" : "0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
              <IconBox active={bwaveActive}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M2 12 Q4 4, 6 12 Q8 20, 10 12 Q12 4, 14 12 Q16 20, 18 12 Q20 4, 22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
                </svg>
              </IconBox>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: S.fs.title, fontWeight: 700, color: S.text }}>B-WAVE Voice</strong>
                  {bwaveActive ? (
                    <SettingsBadge variant="active">{VOICE_MODE_LABELS[bwaveMode].label}</SettingsBadge>
                  ) : (
                    <SettingsBadge variant="coming">Plano Growth+</SettingsBadge>
                  )}
                </div>
                <p style={{ margin: "2px 0 0", fontSize: S.fs.desc, color: S.textSec }}>
                  {bwaveActive
                    ? VOICE_MODE_LABELS[bwaveMode].description
                    : "Voz hiper-realista que atende, converte e conquista."}
                </p>
              </div>
            </div>
            {!bwaveActive && <Lock size={14} style={{ color: S.textMuted, flexShrink: 0 }} />}
            {bwaveActive && (
              <SettingsToggle checked={bwaveOutputEnabled} onChange={handleBwaveOutputToggle} pending={bwaveOutputPending} />
            )}
          </div>

          {/* Teaser quando inativo */}
          {!bwaveActive && (
            <div style={{ paddingTop: "10px", borderTop: `1px solid ${S.border}`, display: "flex", flexDirection: "column", gap: "6px" }}>
              {["Voz responde leads quentes em áudio no WhatsApp", "Nota de voz nativa — aparece com waveform como humano", "IA decide quando usar voz para maximizar conversão"].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: S.textMuted, flexShrink: 0 }} />
                  <span style={{ fontSize: "12px", color: S.textMuted }}>{item}</span>
                </div>
              ))}
              <p style={{ margin: "4px 0 0", fontSize: "11px", color: S.textMuted }}>
                Disponível no plano Growth. Fale com o suporte para ativar.
              </p>
            </div>
          )}

          {/* Controles quando ativo */}
          {bwaveActive && (
            <div style={{ borderTop: `1px solid rgba(0,224,178,0.1)`, paddingTop: "14px", display: "flex", flexDirection: "column", gap: "14px" }}>
              {/* Modo B-WAVE */}
              <div>
                <SLabel>Modo B-WAVE</SLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {(["impact", "mix", "full"] as VoiceMode[]).map((mode) => {
                    const selected = bwaveDraft.mode === mode;
                    const isRec = mode === "mix";
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setBwaveDraft((c) => ({ ...c, mode }))}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: "10px",
                          padding: "10px 12px", borderRadius: "8px",
                          border: selected ? `1px solid rgba(0,224,178,0.25)` : `1px solid ${S.border}`,
                          background: selected ? S.cardActive : S.card,
                          cursor: "pointer", textAlign: "left",
                        }}
                      >
                        <span style={{ width: "8px", height: "8px", marginTop: "5px", borderRadius: "999px", background: selected ? S.teal : S.textMuted, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "13px", fontWeight: 600, color: S.text }}>{VOICE_MODE_LABELS[mode].label}</span>
                            {isRec && <SettingsBadge variant="recommended">Recomendado</SettingsBadge>}
                          </div>
                          <div style={{ fontSize: "11px", color: S.textSec, marginTop: "2px" }}>{VOICE_MODE_LABELS[mode].description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Velocidade B-WAVE */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <SLabel style={{ margin: 0 }}>Velocidade da voz</SLabel>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: S.teal, fontVariantNumeric: "tabular-nums" }}>
                    {bwaveSpeed.toFixed(2)}×
                  </span>
                </div>
                <input
                  type="range" min={0.7} max={1.2} step={0.05}
                  value={bwaveSpeed}
                  disabled={bwaveSpeedPending}
                  onChange={(e) => handleBwaveSpeedChange(Number(e.target.value))}
                  onPointerUp={(e) => handleBwaveSpeedChange(Number((e.target as HTMLInputElement).value))}
                  style={{ width: "100%", accentColor: S.teal, cursor: bwaveSpeedPending ? "default" : "pointer", touchAction: "none" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
                  <span style={{ fontSize: "10px", color: S.textMuted }}>mais calma</span>
                  <span style={{ fontSize: "10px", color: S.textMuted }}>mais dinâmica</span>
                </div>
              </div>

              {/* Configurações avançadas */}
              <CollapsibleAdvanced>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: "10px" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <SLabel>Voice ID</SLabel>
                    <input
                      value={bwaveDraft.voiceId}
                      onChange={(e) => setBwaveDraft((c) => ({ ...c, voiceId: e.target.value }))}
                      placeholder="GM2UA3fbsIaLHcswCDX9"
                      style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: "8px", color: S.text, fontSize: "12px", padding: "8px 10px", fontFamily: "monospace", outline: "none" }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <SLabel>Stability</SLabel>
                    <input type="number" min={0} max={1} step={0.05}
                      value={bwaveDraft.stability}
                      onChange={(e) => setBwaveDraft((c) => ({ ...c, stability: Number(e.target.value) }))}
                      style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: "8px", color: S.text, fontSize: "12px", padding: "8px 10px", outline: "none" }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <SLabel>Similarity Boost</SLabel>
                    <input type="number" min={0} max={1} step={0.05}
                      value={bwaveDraft.similarityBoost}
                      onChange={(e) => setBwaveDraft((c) => ({ ...c, similarityBoost: Number(e.target.value) }))}
                      style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: "8px", color: S.text, fontSize: "12px", padding: "8px 10px", outline: "none" }}
                    />
                  </label>
                </div>
              </CollapsibleAdvanced>

              {/* Save B-WAVE */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={handleSaveBwaveConfig}
                  disabled={bwaveConfigPending}
                  style={{
                    padding: "8px 16px", borderRadius: "8px",
                    border: `1px solid rgba(0,224,178,0.3)`,
                    background: "rgba(0,224,178,0.08)",
                    color: S.teal, fontSize: "12px", fontWeight: 700,
                    cursor: bwaveConfigPending ? "default" : "pointer",
                    opacity: bwaveConfigPending ? 0.7 : 1,
                  }}
                >
                  {bwaveConfigPending ? "Salvando..." : "Salvar configuração B-WAVE"}
                </button>
              </div>
            </div>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}
