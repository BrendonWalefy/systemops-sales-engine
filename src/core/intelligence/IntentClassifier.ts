// LLM Estágio 1: Entende intenção do lead — rápido, barato, retorno estruturado.
// NÃO compõe resposta. NÃO decide o que fazer. Apenas classifica.

import OpenAI from "openai";
import type { Message } from "@/domain/entities/conversation";

const MODEL = "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 30_000;

export type SlotPreference = {
  preferredDate?: string | null;
  preferredPeriod?: "morning" | "afternoon" | "evening" | null;
  preferredTime?: string | null;
  slotChoice?: number | null;
  identifiedTreatment: string | null;
};

export type IntentType =
  | "book_appointment"        // quer agendar, não especificou dia/hora ainda
  | "check_availability"      // pergunta quais horários disponíveis
  | "confirm_slot"            // escolheu um dos slots oferecidos
  | "reject_slots"            // não quer nenhum dos slots oferecidos
  | "cancel_appointment"      // quer cancelar agendamento existente
  | "reschedule_appointment"  // quer remarcar agendamento existente
  | "list_appointments"       // quer ver seus agendamentos
  | "price_inquiry"           // perguntou sobre preço/valor
  | "clinical_urgency"        // menciona dor, urgência, sangramento
  | "needs_human"             // requer ação humana: pede mídia, negociação, falar com dentista, situação especial
  | "patient_arrived"         // paciente avisa que chegou à clínica ou que vai se atrasar para consulta agendada
  | "general_question"        // pergunta geral sobre a clínica
  | "greeting"                // primeiro contato genuíno, sem histórico relevante
  | "acknowledgment"          // reconhecimento mid-conversa: "ok", "blz", "entendi", "certo"
  | "farewell"                // encerramento: "obrigado tchau", "valeu", "até mais"
  | "unclear";                // não foi possível entender

export type IntentClassification = {
  intent: IntentType;
  slotPreference: SlotPreference;
  confidence: number;
  shouldAskClarification: boolean;
  clarificationQuestion?: string | null;
  handoffReason?: string | null;
};

const BASE_SYSTEM_PROMPT = `Você é um classificador de intenções para uma recepcionista virtual de clínica odontológica.

Sua única função é analisar a última mensagem do lead e retornar um JSON estruturado com a intenção detectada.

REGRAS GERAIS:
- Analise SEMPRE no contexto da conversa anterior
- Se o lead mandou "1", "2" ou "3" e há contexto de oferta de horários → intent = "confirm_slot" com slotChoice = número
- Se o lead disse "pode ser", "esse", "quero esse", "tá bom" após oferta → intent = "confirm_slot"
- "nenhum desses", "outro horário", "não tenho disponibilidade" → intent = "reject_slots"
- "quanto custa", "qual o valor", "tem plano" → intent = "price_inquiry"
- "dor", "urgência", "sangramento", "emergência", "urgente" → intent = "clinical_urgency"

REGRA CRÍTICA — nome de tratamento SEM intenção de agendar → "general_question":
- "book_appointment" exige INTENÇÃO EXPLÍCITA de agendar: palavras como "marcar", "agendar", "reservar", "quero fazer", "quero agendar", "pode marcar", "queria agendar".
- Quando o lead menciona um tratamento SEM nenhuma dessas palavras (ex: "lentes", "implante", "clareamento", "quero saber sobre lentes", "me fala de lentes", "o que é lentes") → intent = "general_question", NÃO "book_appointment".
- Isso vale mesmo que "lentes" (ou outro tratamento) esteja na lista de procedimentos da clínica.
- Exemplos de "general_question": "lentes", "implante", "lentes de contato", "clareamento dental", "quero saber sobre implante", "me conta sobre lentes".
- Exemplos de "book_appointment": "quero agendar lentes", "marcar lentes", "quero fazer implante", "pode marcar um horário para lentes".

REGRAS CRÍTICAS PARA ENCERRAMENTO E RECONHECIMENTO:
- "opa blz", "blz", "ok", "entendi", "certo", "tá", "tá bom", "legal", "bacana", "perfeito", "combinado", "show" quando há histórico de conversa → intent = "acknowledgment"
- "obrigado" isolado após receber informação (ex: após receber resposta sobre preço, formas de pagamento, procedimentos) → intent = "acknowledgment"
- "obrigado" + sinal de encerramento ("tchau", "até mais", "até logo", "valeu", "certo obrigado", "ok obrigado", "tá obrigado") → intent = "farewell"
- "tchau", "até mais", "até logo", "até breve", "foi um prazer", "a gente se fala" → intent = "farewell"
- Mensagem vaga/ambígua que não tem conteúdo de negócio (ex: "esse é o normal", "né", "é") quando há contexto de conversa → intent = "acknowledgment" (não é unclear)

REGRA PARA greeting:
- intent = "greeting" SOMENTE quando é genuinamente o primeiro contato sem histórico OU quando o lead recomeça do zero com nova saudação após longa ausência
- "oi", "olá", "bom dia", "boa tarde" COM histórico de conversa ativo → intent = "acknowledgment", NÃO "greeting"

REGRA CRÍTICA — confirm_slot com data diferente dos slots oferecidos:
- Se há oferta de horários pendente E o lead menciona um dia/data DIFERENTE dos slots que foram oferecidos no histórico → intent = "reject_slots" com preferredDate extraída, NÃO "confirm_slot"
- Exemplo: slots oferecidos são "Seg 01/06" mas lead diz "segunda feira dia 08/06" → intent = "reject_slots", preferredDate = "08/06"
- "confirm_slot" SOMENTE quando o lead escolhe pelo número (1, 2, 3) OU aceita claramente um dos dias já oferecidos sem mencionar outra data

REGRA PARA patient_arrived (PRIORIDADE ALTA — avalie antes de unclear e antes de acknowledgment):
Use "patient_arrived" quando o paciente indica presença física na clínica ou avisa sobre chegada/atraso para uma consulta. Exemplos:
- Chegada: "cheguei", "já estou aí", "estou na recepção", "estou esperando", "cheguei antes do horário", "já estou no consultório", "estou na porta", "estou aqui"
- Atraso: "vou me atrasar", "chego uns 10 minutos atrasado", "estou no caminho", "chego em X minutos", "ainda não saí mas já saio"
- Confirmação de presença: "só confirmando que estarei aí", "estarei no horário", "confirmo minha presença"
- Não use quando o paciente está pedindo para agendar, cancelar ou remarcar — nesses casos use o intent específico.

REGRA PARA needs_human (PRIORIDADE ALTA — avalie antes de unclear):
Use "needs_human" quando o lead pedir algo que só um humano pode entregar ou decidir. Exemplos:
- Mídia/arquivos: "me manda as fotos", "pode enviar o orçamento por escrito", "me manda o comprovante", "quero ver o antes e depois", "me envia o resultado do exame"
- Falar com humano: "quero falar com o dentista", "preciso falar com alguém", "pode me ligar?", "me passa o número do doutor"
- Negociação/exceção: "preciso de um desconto", "tem como parcelar diferente?", "tenho uma situação especial", "consigo condição especial?"
- Acordo/troca informal: lead propõe permuta de serviços, menciona combinado anterior com o doutor ou situação negociada fora do fluxo padrão. Exemplos: "a gente combinou que eu faria a tatuagem de vocês e vocês fariam minhas lentes", "o doutor falou que me daria desconto por indicação", "tínhamos combinado antes que você faria X e eu faria Y", "caso queira vir fazer sua tattoo, depois marcamos as lentes" — qualquer proposta de troca ou referência a acordo pessoal com a clínica/doutor.
- Quando needs_human, preencha handoffReason com uma frase curta descrevendo o que o lead pediu (ex: "Lead pediu fotos do procedimento realizado", "Lead quer falar com o dentista", "Lead pediu condição especial de pagamento", "Lead propôs acordo de troca de serviços"). Máximo 60 caracteres.

REGRA PARA unclear:
- Só use "unclear" quando a mensagem tem conteúdo de negócio mas é realmente impossível entender. Não use para mensagens curtas de reconhecimento.

DISTINÇÃO CRÍTICA — list_appointments vs check_availability:
- "list_appointments": lead pergunta sobre OS PRÓPRIOS agendamentos já marcados.
  Exemplos: "tenho algum agendamento?", "o que tenho marcado?", "meus horários",
  "tem algum agendamento para amanhã?", "tenho consulta essa semana?",
  "quando é minha consulta?", "qual meu horário?", "tem algo marcado para mim?"
- "check_availability": lead pergunta sobre horários DISPONÍVEIS para agendar.
  Exemplos: "quais horários disponíveis?", "tem vaga amanhã?", "quando posso agendar?",
  "quero ver os horários livres", "tem horário na sexta?"
- Dúvida entre os dois → prefira "list_appointments" se o lead não indicou intenção de agendar

Para preferências de horário:
- Extraia "amanhã", "sexta", "próxima semana", datas explícitas → preferredDate (verbatim do texto)
- "de manhã", "manhã", "antes do meio-dia" → period = "morning"
- "à tarde", "tarde", "depois do almoço" → period = "afternoon"
- "à noite", "noite" → period = "evening"
- Horas específicas como "às 10h", "10:00", "dez horas" → preferredTime (verbatim)

REGRA PARA identifiedTreatment:
- Tente mapear o que o lead disse para um dos procedimentos da lista fornecida.
- Use correspondência flexível: ignore acentos, maiúsculas, abreviações e erros de digitação comuns.
- Se o lead mencionar algo que claramente corresponde a um procedimento da lista → retorne o nome exato da lista.
- EXCEÇÃO — "avaliação": Se o lead pedir "avaliação" (mesmo que cite um procedimento, ex: "avaliação para lentes", "avaliação de implante"), procure na lista um procedimento que contenha "avaliação" ou "avaliaç". Se encontrar, retorne o nome exato desse procedimento de avaliação. Se NÃO encontrar procedimento de avaliação na lista, retorne null — "avaliação" não é equivalente ao procedimento principal.
- Se o lead mencionar algo que NÃO corresponde a nenhum procedimento da lista → retorne null e use shouldAskClarification: true.
- Se o lead não mencionou nenhum procedimento (ex: "quero marcar uma consulta" sem especificar qual) → retorne null.
- identifiedTreatment só é relevante quando intent = "book_appointment" ou "check_availability".

Retorne APENAS JSON válido, sem markdown, sem explicação.`;

function buildSystemPrompt(treatmentNames: string[]): string {
  if (treatmentNames.length === 0) return BASE_SYSTEM_PROMPT;
  const list = treatmentNames.map((n) => `  - ${n}`).join("\n");
  return `${BASE_SYSTEM_PROMPT}\n\nPROCEDIMENTOS DISPONÍVEIS NESTA CLÍNICA:\n${list}`;
}

// strict: true exige que todo campo em properties conste em required.
// Campos opcionais são declarados como anyOf [type, null].
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "book_appointment",
        "check_availability",
        "confirm_slot",
        "reject_slots",
        "cancel_appointment",
        "reschedule_appointment",
        "list_appointments",
        "price_inquiry",
        "clinical_urgency",
        "needs_human",
        "patient_arrived",
        "general_question",
        "greeting",
        "acknowledgment",
        "farewell",
        "unclear",
      ],
    },
    slotPreference: {
      type: "object",
      properties: {
        preferredDate: { anyOf: [{ type: "string" }, { type: "null" }] },
        preferredPeriod: { anyOf: [{ type: "string", enum: ["morning", "afternoon", "evening"] }, { type: "null" }] },
        preferredTime: { anyOf: [{ type: "string" }, { type: "null" }] },
        slotChoice: { anyOf: [{ type: "number" }, { type: "null" }] },
        identifiedTreatment: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["preferredDate", "preferredPeriod", "preferredTime", "slotChoice", "identifiedTreatment"],
      additionalProperties: false,
    },
    confidence: { type: "number" },
    shouldAskClarification: { type: "boolean" },
    clarificationQuestion: { anyOf: [{ type: "string" }, { type: "null" }] },
    handoffReason: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["intent", "slotPreference", "confidence", "shouldAskClarification", "clarificationQuestion", "handoffReason"],
  additionalProperties: false,
};

export class IntentClassifier {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: OPENAI_TIMEOUT_MS,
      maxRetries: 0,
    });
  }

  async classify(
    latestMessage: string,
    conversationHistory: Message[],
    hasPendingSlotOffer: boolean,
    treatmentNames: string[] = [],
  ): Promise<IntentClassification> {
    // Contexto resumido da conversa (últimas 8 mensagens para economizar tokens)
    const recentHistory = conversationHistory.slice(-8);
    const historyText = recentHistory
      .map((m) => {
        const role = m.author === "lead" ? "Lead" : "Recepcionista";
        return `${role}: ${m.body}`;
      })
      .join("\n");

    const userContent = [
      hasPendingSlotOffer
        ? "CONTEXTO: Há uma oferta de horários pendente aguardando confirmação do lead."
        : "",
      historyText ? `HISTÓRICO RECENTE:\n${historyText}` : "",
      `ÚLTIMA MENSAGEM DO LEAD: ${latestMessage}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await this.client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "intent_classification",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: buildSystemPrompt(treatmentNames) },
        { role: "user", content: userContent },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";

    try {
      const parsed = JSON.parse(raw) as IntentClassification;
      return parsed;
    } catch {
      return {
        intent: "unclear",
        slotPreference: {
          preferredDate: null,
          preferredPeriod: null,
          preferredTime: null,
          slotChoice: null,
          identifiedTreatment: null,
        },
        confidence: 0,
        shouldAskClarification: true,
        clarificationQuestion: "Pode me contar mais sobre o que você precisa?",
      };
    }
  }
}
