"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bot, ChevronRight, Send, Sparkles, Trash2, UserRound } from "lucide-react";
import type { MenuItem, MenuItemIntent } from "@/domain/entities/clinic";

type ChatMessage = { role: "user" | "assistant"; text: string; intent?: string };
type Source = "production" | "draft";

const INTENT_PROMPTS: Record<MenuItemIntent, string> = {
  procedures: "Quais procedimentos vocês fazem?",
  book_appointment: "Quero marcar uma consulta",
  price_inquiry: "Quanto custa a avaliação?",
  location: "Onde fica a clínica?",
  needs_human: "Preciso falar com alguém da equipe",
};

const FALLBACK_PROMPTS = [
  "Quero marcar uma consulta",
  "Quanto custa a avaliação?",
  "Quais procedimentos vocês fazem?",
];

function buildQuickPrompts(menuItems: MenuItem[]): string[] {
  const enabled = menuItems.filter((m) => m.enabled !== false);
  if (enabled.length === 0) return FALLBACK_PROMPTS;
  return enabled.slice(0, 4).map(promptForMenuItem);
}

function promptForMenuItem(item: MenuItem): string {
  const label = item.label.trim();
  if (!label) return INTENT_PROMPTS[item.intent];

  const normalizedLabel = label.toLocaleLowerCase("pt-BR");
  if (item.intent === "procedures") return `Quais opções de ${normalizedLabel} vocês fazem?`;
  if (item.intent === "book_appointment") {
    const action = /agend|marc/i.test(label) ? normalizedLabel : `agendar ${normalizedLabel}`;
    return `Quero ${action}`;
  }
  if (item.intent === "price_inquiry") return `Quero saber sobre ${normalizedLabel}`;
  if (item.intent === "location") return `Quero informações sobre ${normalizedLabel}`;
  if (item.intent === "needs_human") {
    const request = /^falar/i.test(label) ? normalizedLabel : `de ajuda com ${normalizedLabel}`;
    return `Preciso ${request}`;
  }
  return label;
}

export function SimulateClient({ clinicId, clinicName, menuItems }: { clinicId: string; clinicName: string; menuItems: MenuItem[] }) {
  const router = useRouter();
  const [source, setSource] = useState<Source>("production");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: messages.length > 2 || loading ? "smooth" : "auto" });
  }, [messages, loading]);

  function switchSource(next: Source) {
    setSource(next);
    setMessages([]);
    setInput("");
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next: ChatMessage[] = [...messages, { role: "user", text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const body: Record<string, unknown> = { message: text, history: messages, clinicId };
      if (source === "production") body.source = "production";
      const res = await fetch("/api/playbook/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setMessages((p) => [...p, { role: "assistant", text: json.text ?? "Erro ao obter resposta.", intent: json.intent }]);
    } catch {
      setMessages((p) => [...p, { role: "assistant", text: "Erro de conexão." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const isEmpty = messages.length === 0;
  const isProduction = source === "production";
  const quickPrompts = buildQuickPrompts(menuItems);

  return (
    <div className="sim-root" style={{ minHeight: "100vh", background: "var(--background)", display: "flex", flexDirection: "column" }}>
      <style>{`
        .sim-root {
          width: 100%;
          max-width: 100vw;
          overflow-x: hidden;
          -webkit-text-size-adjust: 100%;
        }
        .sim-root *,
        .sim-root *::before,
        .sim-root *::after { box-sizing: border-box; }
        .sim-list::-webkit-scrollbar { width: 4px; }
        .sim-list::-webkit-scrollbar-track { background: transparent; }
        .sim-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        .sim-root input,
        .sim-root textarea,
        .sim-root select {
          caret-color: #00d4aa;
          min-width: 0;
        }
        .sim-root input:focus,
        .sim-root textarea:focus,
        .sim-root select:focus {
          border-color: rgba(0,212,170,0.5) !important;
          box-shadow: 0 0 0 3px rgba(0,212,170,0.12) !important;
          outline: none !important;
        }
        @media (max-width: 820px) {
          .sim-header {
            padding:
              calc(env(safe-area-inset-top, 0px) + 12px)
              calc(env(safe-area-inset-right, 0px) + 16px)
              12px
              calc(env(safe-area-inset-left, 0px) + 16px) !important;
          }
          .sim-body {
            padding:
              14px
              calc(env(safe-area-inset-right, 0px) + 16px)
              calc(env(safe-area-inset-bottom, 0px) + 20px)
              calc(env(safe-area-inset-left, 0px) + 16px) !important;
          }
          .sim-root textarea,
          .sim-root input,
          .sim-root select {
            font-size: 16px !important;
            -webkit-text-size-adjust: 100%;
          }
          .sim-composer { gap: 8px !important; }
        }
      `}</style>

      {/* Breadcrumb + toggle */}
      <div
        className="sim-header"
        style={{
          padding: "16px 28px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button onClick={() => router.push("/app/settings/playbook")} style={crumbBtn}>Configurações</button>
          <ChevronRight size={12} style={{ color: "#3f3f46" }} />
          <button onClick={() => router.push("/app/settings/playbook")} style={crumbBtn}>Playbooks</button>
          <ChevronRight size={12} style={{ color: "#3f3f46" }} />
          <span style={{ fontSize: "12px", color: "#a1a1aa", fontWeight: 500 }}>Simular</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div role="group" style={{ display: "flex", gap: "3px", padding: "3px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.07)", background: "rgba(9,9,11,0.6)" }}>
            {(["production", "draft"] as Source[]).map((s) => {
              const active = source === s;
              const isProd = s === "production";
              return (
                <button
                  key={s}
                  onClick={() => switchSource(s)}
                  style={{
                    background: active ? (isProd ? "rgba(0,212,170,0.14)" : "rgba(251,191,36,0.12)") : "transparent",
                    border: "none",
                    borderRadius: "7px",
                    color: active ? (isProd ? "#00d4aa" : "#fbbf24") : "#52525b",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: 700,
                    padding: "6px 14px",
                    transition: "all 150ms",
                  }}
                >
                  {isProd ? "Produção" : "Rascunho"}
                </button>
              );
            })}
          </div>
          {!isEmpty && (
            <button
              onClick={() => setMessages([])}
              title="Limpar conversa"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#71717a", cursor: "pointer", padding: "7px", borderRadius: "8px", display: "flex", alignItems: "center" }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Chat body */}
      <div
        className="sim-body"
        style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: "800px", width: "100%", margin: "0 auto", padding: "20px 28px 28px", boxSizing: "border-box" }}
      >
        {/* Source badge */}
        <div style={{ marginBottom: "18px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "11px",
            fontWeight: 700,
            padding: "4px 10px",
            borderRadius: "999px",
            border: isProduction ? "1px solid rgba(0,212,170,0.22)" : "1px solid rgba(251,191,36,0.22)",
            background: isProduction ? "rgba(0,212,170,0.08)" : "rgba(251,191,36,0.08)",
            color: isProduction ? "#00d4aa" : "#fbbf24",
          }}>
            <Sparkles size={11} />
            {isProduction ? `Espelho da produção — ${clinicName}` : "Versão ativa do playbook"}
          </span>
          <span style={{ fontSize: "11px", color: "#3f3f46" }}>
            {isProduction
              ? "Lê de clinics.* + tratamentos — idêntico ao que o lead real recebe"
              : "Lê do playbook_version ativo — útil para testar antes de publicar"}
          </span>
        </div>

        {/* Messages */}
        <div
          ref={listRef}
          className="sim-list"
          style={{
            flex: 1,
            minHeight: "360px",
            maxHeight: "calc(100vh - 330px)",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            paddingBottom: "4px",
          }}
        >
          {isEmpty ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", color: "#71717a", fontSize: "13px", textAlign: "center", padding: "40px 16px" }}>
              <span style={{ width: "48px", height: "48px", borderRadius: "999px", display: "grid", placeItems: "center", background: "rgba(0,212,170,0.1)", color: "#00d4aa", border: "1px solid rgba(0,212,170,0.2)" }}>
                <Bot size={22} />
              </span>
              <span style={{ maxWidth: "320px", lineHeight: 1.6 }}>
                Simule uma conversa como se fosse um paciente entrando em contato.
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px" }}>
                {quickPrompts.map((p) => (
                  <button key={p} type="button" onClick={() => setInput(p)} style={quickPromptStyle}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => <Bubble key={i} message={m} />)
          )}
          {loading && <Bubble message={{ role: "assistant", text: "Digitando..." }} />}
        </div>

        {/* Input */}
        <div className="sim-composer" style={{ paddingTop: "16px", display: "flex", gap: "10px", alignItems: "flex-end" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
            {!isEmpty && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {quickPrompts.slice(0, 2).map((p) => (
                  <button key={p} type="button" onClick={() => setInput(p)} style={quickPromptStyle}>{p}</button>
                ))}
              </div>
            )}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Escreva como se fosse um paciente..."
              rows={2}
              disabled={loading}
              style={{
                width: "100%",
                minHeight: "52px",
                maxHeight: "120px",
                background: "rgba(15,17,23,0.72)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "12px",
                color: "#e4e4e7",
                fontSize: "16px",
                padding: "12px 14px",
                outline: "none",
                fontFamily: "inherit",
                resize: "vertical",
                lineHeight: 1.45,
                opacity: loading ? 0.5 : 1,
                boxSizing: "border-box",
              }}
            />
          </div>
          <button
            type="button"
            onClick={send}
            disabled={loading || !input.trim()}
            style={{
              background: input.trim() && !loading ? "#00d4aa" : "rgba(255,255,255,0.05)",
              border: "none",
              borderRadius: "12px",
              color: input.trim() && !loading ? "#031f1a" : "#52525b",
              cursor: input.trim() && !loading ? "pointer" : "default",
              height: "52px",
              minWidth: "52px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "all 150ms",
              boxShadow: input.trim() && !loading ? "0 10px 24px rgba(0,212,170,0.18)" : "none",
            }}
          >
            <Send size={17} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isAI = message.role === "assistant";
  return (
    <div style={{ display: "flex", flexDirection: isAI ? "row-reverse" : "row", gap: "10px", alignItems: "flex-start" }}>
      <span style={{
        width: "28px", height: "28px", borderRadius: "999px", display: "grid", placeItems: "center", flexShrink: 0,
        background: isAI ? "rgba(0,212,170,0.16)" : "rgba(255,255,255,0.06)",
        color: isAI ? "#00d4aa" : "#a1a1aa",
        border: `1px solid ${isAI ? "rgba(0,212,170,0.26)" : "rgba(255,255,255,0.08)"}`,
      }}>
        {isAI ? <Bot size={14} /> : <UserRound size={14} />}
      </span>
      <div style={{ display: "flex", flexDirection: "column", alignItems: isAI ? "flex-end" : "flex-start", gap: "4px", flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em", color: isAI ? "#00d4aa" : "#71717a" }}>
          {isAI ? "IA" : "Você (simulando paciente)"}
        </span>
        <div style={{
          maxWidth: "80%",
          padding: "10px 14px",
          borderRadius: isAI ? "14px 3px 14px 14px" : "3px 14px 14px 14px",
          background: isAI ? "linear-gradient(135deg, rgba(0,212,170,0.88), rgba(20,184,166,0.62))" : "rgba(255,255,255,0.08)",
          border: `1px solid ${isAI ? "rgba(0,212,170,0.22)" : "rgba(255,255,255,0.07)"}`,
          color: isAI ? "#ecfdf5" : "#d4d4d8",
          fontSize: "14px",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          boxShadow: isAI ? "0 8px 24px rgba(0,212,170,0.12)" : "none",
        }}>
          {message.text}
        </div>
        {isAI && message.intent && (
          <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", color: "#00d4aa", padding: "2px 7px", background: "rgba(0,212,170,0.1)", borderRadius: "999px", border: "1px solid rgba(0,212,170,0.18)" }}>
            {message.intent}
          </span>
        )}
      </div>
    </div>
  );
}

const crumbBtn: React.CSSProperties = {
  background: "transparent", border: "none", color: "#52525b", cursor: "pointer", fontSize: "12px", padding: 0,
};

const quickPromptStyle: React.CSSProperties = {
  border: "1px solid rgba(0,212,170,0.16)",
  borderRadius: "999px",
  background: "rgba(0,212,170,0.07)",
  color: "#9ffce5",
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: 700,
  padding: "6px 11px",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
