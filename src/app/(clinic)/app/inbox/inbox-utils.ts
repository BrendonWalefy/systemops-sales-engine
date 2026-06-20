import type { ConversationCategory } from "@/domain/value-objects/conversation-category";

export type TempKey = "hot" | "warm" | "cold";

export function tempKey(temp: string | null): TempKey {
  if (temp === "hot") return "hot";
  if (temp === "warm") return "warm";
  return "cold";
}

export function tempLabel(temp: string | null): { label: string; cls: TempKey } {
  if (temp === "hot") return { label: "Quente", cls: "hot" };
  if (temp === "warm") return { label: "Morno", cls: "warm" };
  return { label: "Frio", cls: "cold" };
}

export function avatarColor(temp: string | null): string {
  if (temp === "hot") return "var(--hot)";
  if (temp === "warm") return "var(--warm)";
  return "var(--cold)";
}

export function relativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay)
      return date.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      });
    return `${h}h`;
  }
  return `${Math.floor(h / 24)}d`;
}

export function statusLabel(status: string): { label: string; handoff: boolean } {
  const map: Record<string, { label: string; handoff: boolean }> = {
    new:                    { label: "Novo",             handoff: false },
    waiting_response:       { label: "Aguardando",       handoff: false },
    in_conversation:        { label: "Em conversa",      handoff: false },
    follow_up_due:          { label: "Recuperação",      handoff: true  },
    appointment_scheduled:  { label: "Agendado",         handoff: false },
    lost:                   { label: "Perdido",          handoff: true  },
    won:                    { label: "Ganho",            handoff: false },
  };
  return map[status] ?? { label: status, handoff: false };
}

export function channelLabel(channel: string): string {
  const map: Record<string, string> = {
    whatsapp:     "WhatsApp",
    instagram:    "Instagram",
    landing_form: "Formulário",
    google_ads:   "Google Ads",
    meta_ads:     "Meta Ads",
    phone:        "Telefone",
    referral:     "Indicação",
    manual:       "Manual",
  };
  return map[channel] ?? channel;
}

export function conversationCategoryLabel(category: ConversationCategory | string): string {
  const map: Record<string, string> = {
    sales: "Comercial",
    operational: "Operacional",
    vendor: "Fornecedor",
    spam: "Spam",
    archived: "Arquivada",
  };
  return map[category] ?? category;
}
