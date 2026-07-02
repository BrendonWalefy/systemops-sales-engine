/**
 * Roteiros CURADOS de conversas da clínica demo "Odonto Marques".
 *
 * Cada roteiro é uma conversa COERENTE de ponta a ponta (lead → Marina → ... →
 * desfecho). O lado do lead é fixo; as respostas da Marina são geradas pela IA real
 * em `generate-demo-conversation.ts`. Isso substitui as threads fabricadas antigas
 * (frases genéricas soltas + padding aleatório) por conteúdo que parece — e é — o
 * nosso produto, servindo para a demo e para marketing.
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
  booked: boolean; // gera um agendamento real
  needsAttention?: boolean;
  attentionReason?: string;
  aiPaused?: boolean;
  afterHours?: boolean; // conversa que começou fora do horário
  voiceStyle?: "bwave" | "simple"; // rótulo do estilo de voz da conversa (para doc/kit)
  daysAgo: number;
  turns: DemoTurn[];
};

// Frase natural de abertura do lead por tratamento.
const OPENER: Record<string, string> = {
  "Lentes de porcelana": "Oi! Vi o Instagram de vocês e fiquei encantada com as lentes. Como funciona?",
  "Implante dentário": "Boa tarde! Perdi um dente e queria avaliar um implante com vocês.",
  "Clareamento dental": "Oi! Queria clarear os dentes pra um casamento. Vocês fazem?",
  "Harmonização facial": "Olá! Vocês fazem harmonização facial? Queria entender melhor.",
  "Alinhadores invisíveis": "Oi! Queria alinhar os dentes sem aparelho fixo. Dá pra fazer com vocês?",
  "Avaliação estética": "Boa tarde! Gostaria de marcar uma avaliação do meu sorriso.",
};
const NIGHT_OPENER: Record<string, string> = {
  "Lentes de porcelana": "Oi! Tô vendo o Insta de vocês agora à noite e amei as lentes. Ainda dá pra saber o valor?",
  "Clareamento dental": "Boa noite! Sei que é tarde, mas quanto fica o clareamento?",
  "Implante dentário": "Oi, boa noite! Vi vocês agora tarde — queria saber sobre implante.",
};
function opener(t: string): string {
  return OPENER[t] ?? `Oi! Queria saber sobre ${t.toLowerCase()}.`;
}

// ── Templates de fluxo (cada um = uma conversa coerente) ─────────────────────

// Lead quente: preço → objeção → horários → fecha. Desfecho: agendado.
function tplBookWithObjection(
  key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number,
): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "appointment_scheduled",
    temperature: "hot", booked: true, daysAgo,
    turns: [
      { lead: opener(treatment), action: { kind: "price", treatment } },
      { lead: "Quanto fica pra fazer?", action: { kind: "price", treatment } },
      { lead: "Nossa, pra ser sincera achei um pouco caro…", action: { kind: "general" } },
      { lead: "Entendi. E como faço pra marcar a avaliação?", action: { kind: "slots" } },
      { lead: "Quero o primeiro horário 😊", action: { kind: "confirm", slotIndex: 1 } },
    ],
  };
}

// Captura fora do horário: começa à noite, preço, oferta de horário. Desfecho: em conversa.
function tplAfterHours(
  key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number,
): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "in_conversation",
    temperature: "hot", booked: false, afterHours: true, daysAgo,
    turns: [
      { lead: NIGHT_OPENER[treatment] ?? opener(treatment), action: { kind: "price", treatment } },
      { lead: "Ah que ótimo que vocês respondem à noite! E dá pra parcelar?", action: { kind: "general" } },
      { lead: "Perfeito. Quais horários vocês têm essa semana?", action: { kind: "slots" } },
    ],
  };
}

// Agendamento direto: já quer marcar. Desfecho: agendado.
function tplQuickBook(
  key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number,
): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "appointment_scheduled",
    temperature: "hot", booked: true, daysAgo,
    turns: [
      { lead: `Oi! Quero marcar uma avaliação pra ${treatment.toLowerCase()}.`, action: { kind: "slots" } },
      { lead: "Pode ser o segundo horário", action: { kind: "confirm", slotIndex: 2 } },
    ],
  };
}

// Morno: preço → "vou pensar". Desfecho: aguardando resposta.
function tplThinking(
  key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number,
): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "waiting_response",
    temperature: "warm", booked: false, daysAgo,
    turns: [
      { lead: opener(treatment), action: { kind: "price", treatment } },
      { lead: "Legal! Vou ver minha agenda e te retorno, tá? Obrigada!", action: { kind: "acknowledgment" } },
    ],
  };
}

// Recuperação: conversa parou, IA reengaja. Desfecho: follow-up devido.
function tplRecovery(
  key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number,
): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "follow_up_due",
    temperature: "warm", booked: false, daysAgo,
    turns: [
      { lead: opener(treatment), action: { kind: "price", treatment } },
      { lead: "Deixa eu ver aqui e te falo.", action: { kind: "acknowledgment" } },
      { lead: "", action: { kind: "reengagement", lastAppointmentLabel: "sua avaliação" } },
    ],
  };
}

// Urgência com handoff. Desfecho: precisa de atenção humana.
function tplUrgency(
  key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number,
): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "in_conversation",
    temperature: null, booked: false, needsAttention: true,
    attentionReason: "Lead relatou dor — encaminhado para a equipe", daysAgo,
    turns: [
      { lead: "Socorro, tô com uma dor muito forte no dente, o que eu faço?", action: { kind: "urgency" } },
      { lead: "Consigo ir hoje ainda?", action: { kind: "handoff", reason: "Urgência clínica — encaixe no dia" } },
    ],
  };
}

// Remarcação de paciente existente. Desfecho: agendado.
function tplReschedule(
  key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number,
): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "appointment_scheduled",
    temperature: null, booked: true, daysAgo,
    turns: [
      { lead: "Oi! Preciso remarcar minha consulta de amanhã, surgiu um imprevisto.", action: { kind: "reschedule" } },
      { lead: "O primeiro tá ótimo, obrigada!", action: { kind: "confirm", slotIndex: 1 } },
    ],
  };
}

// Ganho curto (histórico). Desfecho: won.
function tplWonShort(
  key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number,
): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "won", temperature: null, booked: true, daysAgo,
    turns: [
      { lead: `Fiz a ${treatment.toLowerCase()} com vocês e ficou perfeito, muito obrigada!`, action: { kind: "farewell" } },
    ],
  };
}

// Perdido curto (histórico). Desfecho: lost.
function tplLostShort(
  key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number,
): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "lost", temperature: null, booked: false, daysAgo,
    turns: [
      { lead: opener(treatment), action: { kind: "price", treatment } },
      { lead: "Por enquanto vou deixar pra depois, obrigada.", action: { kind: "farewell" } },
    ],
  };
}

// Lentes com VÍDEO do procedimento (reusa o vídeo da Ximendes). Voz B-WAVE. Agendado.
function tplVideoLentes(
  key: string, leadName: string, channel: DemoChannel, daysAgo: number,
): DemoConversationSpec {
  return {
    key, leadName, treatment: "Lentes de porcelana", channel,
    status: "appointment_scheduled", temperature: "hot", booked: true,
    voiceStyle: "bwave", daysAgo,
    turns: [
      { lead: opener("Lentes de porcelana"), action: { kind: "price", treatment: "Lentes de porcelana" } },
      { lead: "Dá pra ver como fica o resultado antes de decidir?", action: { kind: "general" }, media: "video" },
      { lead: "Amei! Como faço pra marcar a avaliação?", action: { kind: "slots" } },
      { lead: "Quero o primeiro horário 😊", action: { kind: "confirm", slotIndex: 1 } },
    ],
  };
}

// Conversa com VOZ premium B-WAVE (mix de áudio e texto). Agendado.
function tplVoiceBwave(
  key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number,
): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "appointment_scheduled",
    temperature: "hot", booked: true, voiceStyle: "bwave", daysAgo,
    turns: [
      { lead: opener(treatment), action: { kind: "price", treatment }, voice: true },
      { lead: "Que atendimento gostoso, e dá pra parcelar?", action: { kind: "general" }, voice: true },
      { lead: "Perfeito, quero marcar!", action: { kind: "slots" }, voice: true },
      { lead: "O primeiro tá ótimo pra mim", action: { kind: "confirm", slotIndex: 1 } },
    ],
  };
}

// Conversa com VOZ simples (OpenAI) — mix de áudio e texto. Em conversa.
function tplVoiceSimple(
  key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number,
): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "in_conversation",
    temperature: "warm", booked: false, voiceStyle: "simple", daysAgo,
    turns: [
      { lead: opener(treatment), action: { kind: "price", treatment }, voice: true },
      { lead: "Ah entendi! E funciona bem mesmo?", action: { kind: "general" } },
      { lead: "Legal, vou pensar e te chamo", action: { kind: "acknowledgment" }, voice: true },
    ],
  };
}

// Recuperação com CONTEÚDO (imagem/vídeo) na reengagem — follow-up atraente. Devido.
function tplRecoveryMedia(
  key: string, leadName: string, treatment: string, channel: DemoChannel, daysAgo: number,
): DemoConversationSpec {
  return {
    key, leadName, treatment, channel, status: "follow_up_due",
    temperature: "warm", booked: false, daysAgo,
    turns: [
      { lead: opener(treatment), action: { kind: "price", treatment } },
      { lead: "Deixa eu pensar aqui e te falo.", action: { kind: "acknowledgment" } },
      { lead: "", action: { kind: "reengagement", lastAppointmentLabel: "sua avaliação" }, media: "image" },
    ],
  };
}

// ── Montagem: ~40 conversas ricas e distintas ────────────────────────────────
export const DEMO_CONVERSATIONS: DemoConversationSpec[] = [
  // Fecham (agendados) — o coração da demo
  tplBookWithObjection("book-lentes", "Camila Rocha", "Lentes de porcelana", "instagram", 1),
  tplBookWithObjection("book-implante", "Lucas Ferreira", "Implante dentário", "whatsapp", 2),
  tplBookWithObjection("book-harmo", "Renata Lima", "Harmonização facial", "meta_ads", 1),
  tplBookWithObjection("book-clareamento", "Mariana Alves", "Clareamento dental", "whatsapp", 3),
  tplQuickBook("quick-avaliacao", "Pedro Henrique Dias", "Avaliação estética", "referral", 0),
  tplQuickBook("quick-alinhadores", "Ana Beatriz Souza", "Alinhadores invisíveis", "instagram", 2),
  tplQuickBook("quick-lentes", "Larissa Fonseca", "Lentes de porcelana", "whatsapp", 1),
  tplReschedule("resched-implante", "Rafael Mendes", "Implante dentário", "whatsapp", 0),
  tplReschedule("resched-clareamento", "Bruna Castro", "Clareamento dental", "whatsapp", 1),

  // Vitrine de conteúdo e voz — vídeo de procedimento, voz premium e voz simples
  tplVideoLentes("video-lentes-1", "Isabela Ramos", "instagram", 1),
  tplVideoLentes("video-lentes-2", "Sofia Prado", "meta_ads", 2),
  tplVoiceBwave("voice-bwave-implante", "Clara Vasconcelos", "Implante dentário", "whatsapp", 1),
  tplVoiceBwave("voice-bwave-harmo", "Lorena Siqueira", "Harmonização facial", "instagram", 2),
  tplVoiceSimple("voice-simple-clareamento", "Diego Furtado", "Clareamento dental", "whatsapp", 3),
  tplRecoveryMedia("rec-media-lentes", "Yasmin Rezende", "Lentes de porcelana", "instagram", 4),

  // Fora do horário — o argumento de venda
  tplAfterHours("night-lentes", "Sabrina Melo", "Lentes de porcelana", "instagram", 1),
  tplAfterHours("night-clareamento", "Juliana Costa", "Clareamento dental", "meta_ads", 2),
  tplAfterHours("night-implante", "Thiago Barros", "Implante dentário", "whatsapp", 3),

  // Quentes/mornos em conversa
  tplThinking("think-lentes", "Fernanda Gomes", "Lentes de porcelana", "instagram", 2),
  tplThinking("think-harmo", "Patrícia Gomes", "Harmonização facial", "whatsapp", 4),
  tplThinking("think-alinhadores", "Gabriela Nunes", "Alinhadores invisíveis", "meta_ads", 3),
  tplThinking("think-clareamento", "Vanessa Dias", "Clareamento dental", "whatsapp", 5),

  // Recuperação (follow-up automático)
  tplRecovery("rec-lentes", "Daniela Rocha", "Lentes de porcelana", "instagram", 6),
  tplRecovery("rec-implante", "Marcela Alves", "Implante dentário", "whatsapp", 7),
  tplRecovery("rec-clareamento", "Leonardo Pinto", "Clareamento dental", "meta_ads", 5),
  tplRecovery("rec-avaliacao", "Rafaela Souza", "Avaliação estética", "whatsapp", 8),

  // Urgência → handoff (mostra o limite saudável da IA)
  tplUrgency("urg-implante", "Felipe Santos", "Implante dentário", "whatsapp", 0),
  tplUrgency("urg-lentes", "Otávio Brandão", "Lentes de porcelana", "whatsapp", 1),

  // Histórico ganho (won) — receita realizada
  tplWonShort("won-clareamento", "Bruno Cardoso", "Clareamento dental", "whatsapp", 12),
  tplWonShort("won-limpeza", "Carolina Ribeiro", "Avaliação estética", "referral", 14),
  tplWonShort("won-lentes", "Eduardo Teixeira", "Lentes de porcelana", "instagram", 16),
  tplWonShort("won-harmo", "Aline Moreira", "Harmonização facial", "meta_ads", 18),
  tplWonShort("won-implante", "Vinícius Costa", "Implante dentário", "whatsapp", 20),
  tplWonShort("won-alinhadores", "Tatiana Melo", "Alinhadores invisíveis", "whatsapp", 22),

  // Histórico perdido (lost)
  tplLostShort("lost-implante", "Henrique Barros", "Implante dentário", "meta_ads", 15),
  tplLostShort("lost-lentes", "Bárbara Nogueira", "Lentes de porcelana", "instagram", 17),
  tplLostShort("lost-harmo", "Cristina Tavares", "Harmonização facial", "whatsapp", 19),
  tplLostShort("lost-alinhadores", "Adriana Macedo", "Alinhadores invisíveis", "referral", 21),
  tplLostShort("lost-clareamento", "Mateus Andrade", "Clareamento dental", "whatsapp", 23),
  tplLostShort("lost-avaliacao", "Gustavo Queiroz", "Avaliação estética", "meta_ads", 25),
];
