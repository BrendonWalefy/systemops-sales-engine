/**
 * Roteiros CURADOS de conversas da clínica demo "Odonto Marques".
 *
 * Cada roteiro é a sequência de mensagens do LEAD (progressão natural). O gerador
 * (`generate-demo-conversation.ts`) roda o pipeline real — classifica cada mensagem e
 * a Marina responde de verdade — então a conversa flui como em produção.
 *
 * `daysAgo` controla a ordem no inbox (ordena por mais recente): as conversas RICAS
 * (mais turnos, vídeo, voz) usam daysAgo pequeno → aparecem PRIMEIRO.
 */
import type { DemoTurn } from "./generate-demo-conversation";

export type DemoConvStatus =
  | "in_conversation"
  | "waiting_response"
  | "appointment_scheduled"
  | "follow_up_due"
  | "won"
  | "lost";

export type DemoChannel = "whatsapp" | "instagram" | "meta_ads" | "referral";

export type DemoConversationSpec = {
  key: string;
  leadName: string;
  treatment: string;
  channel: DemoChannel;
  status: DemoConvStatus;
  temperature: "hot" | "warm" | "cold" | null;
  booked: boolean;
  needsAttention?: boolean;
  attentionReason?: string;
  aiPaused?: boolean;
  afterHours?: boolean;
  voiceStyle?: "bwave" | "simple";
  daysAgo: number;
  turns: DemoTurn[];
};

// ── Linhas naturais do lead por tratamento ───────────────────────────────────
const HOW: Record<string, string> = {
  "Lentes de porcelana": "Oi! Vi o Instagram de vocês e me apaixonei pelas lentes de porcelana. Me explica como funciona pra fazer?",
  "Implante dentário": "Boa tarde! Perdi um dente e queria entender como funciona o implante com vocês.",
  "Clareamento dental": "Oi! Queria clarear os dentes pra um evento. Como funciona o clareamento de vocês?",
  "Harmonização facial": "Olá! Vocês fazem harmonização facial? Queria entender como é o procedimento.",
  "Alinhadores invisíveis": "Oi! Queria alinhar os dentes sem aparelho fixo. Como funcionam os alinhadores?",
  "Avaliação estética": "Boa tarde! Queria fazer uma avaliação do meu sorriso pra saber o que dá pra melhorar.",
};
const NIGHT: Record<string, string> = {
  "Lentes de porcelana": "Oi! Sei que é tarde, mas vi o Insta de vocês agora e amei as lentes. Quanto fica?",
  "Clareamento dental": "Boa noite! Desculpa a hora — quanto custa o clareamento de vocês?",
  "Implante dentário": "Oi, boa noite! Vi vocês agora à noite e queria saber sobre implante.",
};
const how = (t: string) => HOW[t] ?? `Oi! Queria saber como funciona ${t.toLowerCase()}.`;
const PRICE = "E quanto fica o investimento?";
const AVAIL = "Entendi! Quero marcar a avaliação, quais horários vocês têm?";
const CONFIRM = "O primeiro horário tá ótimo pra mim 😊";

// ── Templates (turns = mensagens do lead; a IA classifica e responde) ────────

// Lead quente: entende → preço → horários → fecha. Agendado. (fluxo-vitrine suave)
function tplBook(key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "appointment_scheduled",
    temperature: "hot", booked: true, daysAgo,
    turns: [
      { lead: how(treatment) },
      { lead: PRICE },
      { lead: AVAIL },
      { lead: CONFIRM },
    ],
  };
}

// Lentes com VÍDEO do procedimento (reusa vídeo da Ximendes). Voz B-WAVE. Agendado.
function tplVideoLentes(key: string, leadName: string, channel: DemoChannel, daysAgo: number): DemoConversationSpec {
  return {
    key, leadName, treatment: "Lentes de porcelana", channel,
    status: "appointment_scheduled", temperature: "hot", booked: true, voiceStyle: "bwave", daysAgo,
    turns: [
      { lead: how("Lentes de porcelana") },
      { lead: "Antes de decidir, dá pra ver como fica o resultado?", media: "video" },
      { lead: "Amei! Quero marcar a avaliação, quais horários vocês têm?" },
      { lead: CONFIRM },
    ],
  };
}

// Conversa com VOZ premium B-WAVE (mix de áudio e texto). Agendado.
function tplVoiceBwave(key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "appointment_scheduled",
    temperature: "hot", booked: true, voiceStyle: "bwave", daysAgo,
    turns: [
      { lead: how(treatment), voice: true },
      { lead: PRICE, voice: true },
      { lead: "Que atendimento gostoso! Quero marcar, quais horários vocês têm?", voice: true },
      { lead: CONFIRM },
    ],
  };
}

// Conversa com VOZ simples (OpenAI). Mix de áudio e texto. Em conversa.
function tplVoiceSimple(key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "in_conversation",
    temperature: "warm", booked: false, voiceStyle: "simple", daysAgo,
    turns: [
      { lead: how(treatment), voice: true },
      { lead: PRICE },
      { lead: "Ah entendi! Vou pensar com carinho e te chamo, tá?", voice: true },
    ],
  };
}

// Captura fora do horário. Em conversa.
function tplAfterHours(key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "in_conversation",
    temperature: "hot", booked: false, afterHours: true, daysAgo,
    turns: [
      { lead: NIGHT[treatment] ?? how(treatment) },
      { lead: "Que ótimo que vocês respondem à noite! E dá pra parcelar?" },
      { lead: "Perfeito. Quais horários vocês têm essa semana?" },
    ],
  };
}

// Agendamento direto. Agendado.
function tplQuickBook(key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "appointment_scheduled",
    temperature: "hot", booked: true, daysAgo,
    turns: [
      { lead: `Oi! Quero marcar uma avaliação pra ${treatment.toLowerCase()}. Quais horários vocês têm?` },
      { lead: "Pode ser o segundo horário 😊" },
    ],
  };
}

// Remarcação de paciente. Agendado.
function tplReschedule(key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "appointment_scheduled",
    temperature: null, booked: true, daysAgo,
    turns: [
      { lead: "Oi! Preciso remarcar minha consulta de amanhã, surgiu um imprevisto." },
      { lead: "O primeiro horário tá ótimo, obrigada!" },
    ],
  };
}

// Urgência → handoff humano. Precisa de atenção.
function tplUrgency(key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "in_conversation",
    temperature: null, booked: false, needsAttention: true,
    attentionReason: "Lead relatou dor — encaminhado para a equipe", daysAgo,
    turns: [
      { lead: "Gente, socorro! Tô com uma dor muito forte no dente, o que eu faço?" },
      { lead: "Consigo passar aí hoje ainda?" },
    ],
  };
}

// Morno: preço → "vou pensar". Aguardando resposta.
function tplThinking(key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "waiting_response",
    temperature: "warm", booked: false, daysAgo,
    turns: [
      { lead: how(treatment) },
      { lead: "Legal! Vou ver minha agenda e te retorno, obrigada!" },
    ],
  };
}

// Recuperação: parou → IA reengaja (proativo). Follow-up devido.
function tplRecovery(key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number, media?: "image"): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "follow_up_due",
    temperature: "warm", booked: false, daysAgo,
    turns: [
      { lead: how(treatment) },
      { lead: "Deixa eu ver minha agenda e te falo." },
      { lead: "", media }, // turno proativo: reengajamento da IA (com mídia opcional)
    ],
  };
}

// ── Montagem: ricas primeiro (daysAgo crescente = mais recente no topo) ───────
export const DEMO_CONVERSATIONS: DemoConversationSpec[] = [
  // ── TOPO DO INBOX: as mais completas/ricas (5 e 4 turnos, vídeo, voz) ──
  tplBook("book-lentes", "Camila Rocha", "Lentes de porcelana", "instagram", 0),
  tplVideoLentes("video-lentes-1", "Isabela Ramos", "instagram", 0),
  tplVoiceBwave("voice-bwave-implante", "Clara Vasconcelos", "Implante dentário", "whatsapp", 0),
  tplBook("book-implante", "Lucas Ferreira", "Implante dentário", "whatsapp", 0),
  tplVideoLentes("video-lentes-2", "Sofia Prado", "meta_ads", 1),
  tplVoiceBwave("voice-bwave-harmo", "Lorena Siqueira", "Harmonização facial", "instagram", 1),
  tplBook("book-harmo", "Renata Lima", "Harmonização facial", "meta_ads", 1),
  tplBook("book-clareamento", "Mariana Alves", "Clareamento dental", "whatsapp", 1),

  // ── Fora do horário + voz simples (3-4 turnos) ──
  tplAfterHours("night-lentes", "Sabrina Melo", "Lentes de porcelana", "instagram", 1),
  tplAfterHours("night-clareamento", "Juliana Costa", "Clareamento dental", "meta_ads", 2),
  tplVoiceSimple("voice-simple-clareamento", "Diego Furtado", "Clareamento dental", "whatsapp", 2),
  tplAfterHours("night-implante", "Thiago Barros", "Implante dentário", "whatsapp", 2),

  // ── Recuperação com conteúdo (follow-up atraente) ──
  tplRecovery("rec-media-lentes", "Yasmin Rezende", "Lentes de porcelana", "instagram", 3, "image"),
  tplRecovery("rec-implante", "Marcela Alves", "Implante dentário", "whatsapp", 4),
  tplRecovery("rec-clareamento", "Leonardo Pinto", "Clareamento dental", "meta_ads", 5),

  // ── Agendamentos diretos + remarcação (2 turnos) ──
  tplQuickBook("quick-avaliacao", "Pedro Henrique Dias", "Avaliação estética", "referral", 3),
  tplQuickBook("quick-alinhadores", "Ana Beatriz Souza", "Alinhadores invisíveis", "instagram", 4),
  tplReschedule("resched-implante", "Rafael Mendes", "Implante dentário", "whatsapp", 3),
  tplReschedule("resched-clareamento", "Bruna Castro", "Clareamento dental", "whatsapp", 5),

  // ── Urgência → handoff (mostra o limite saudável da IA) ──
  tplUrgency("urg-implante", "Felipe Santos", "Implante dentário", "whatsapp", 2),
  tplUrgency("urg-lentes", "Otávio Brandão", "Lentes de porcelana", "whatsapp", 4),

  // ── Mais conversas completas (variando tratamento/canal) ──
  tplBook("book-alinhadores", "Vanessa Dias", "Alinhadores invisíveis", "instagram", 2),
  tplBook("book-avaliacao", "Larissa Fonseca", "Avaliação estética", "whatsapp", 3),
  tplVoiceBwave("voice-bwave-lentes", "Beatriz Coelho", "Lentes de porcelana", "instagram", 2),
  tplVoiceSimple("voice-simple-alinhadores", "Rodrigo Pacheco", "Alinhadores invisíveis", "whatsapp", 4),
  tplQuickBook("quick-lentes", "Amanda Nunes", "Lentes de porcelana", "instagram", 5),
  tplQuickBook("quick-clareamento", "Letícia Barros", "Clareamento dental", "meta_ads", 6),
  tplAfterHours("night-harmo", "Priscila Mendes", "Harmonização facial", "instagram", 3),
  tplRecovery("rec-avaliacao", "Rafaela Souza", "Avaliação estética", "whatsapp", 6),
  tplRecovery("rec-harmo", "Natália Cardoso", "Harmonização facial", "meta_ads", 7),

  // ── Mornos "vou pensar" ──
  tplThinking("think-lentes", "Fernanda Gomes", "Lentes de porcelana", "instagram", 6),
  tplThinking("think-harmo", "Patrícia Gomes", "Harmonização facial", "whatsapp", 7),
  tplThinking("think-clareamento", "Aline Barbosa", "Clareamento dental", "whatsapp", 8),
  tplThinking("think-alinhadores", "Gabriela Nunes", "Alinhadores invisíveis", "meta_ads", 8),
];
