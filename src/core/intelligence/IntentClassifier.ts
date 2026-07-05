// LLM Estágio 1: Entende intenção do lead — rápido, barato, retorno estruturado.
// NÃO compõe resposta. NÃO decide o que fazer. Apenas classifica.

import OpenAI from "openai";
import type { Message } from "@/domain/entities/conversation";
import type { PromptContext } from "@/core/intelligence/PromptContextBuilder";

// Configurável por env para benchmark de modelo (Fase 5 do plano de excelência
// conversacional). Ao trocar, adicionar o preço em cost-estimator.ts.
const MODEL = process.env.OPENAI_CLASSIFIER_MODEL?.trim() || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 30_000;

export type TreatmentOption = {
  name: string;
  aliases?: string[];
};

export type SlotPreference = {
  preferredDate?: string | null;
  preferredPeriod?: "morning" | "afternoon" | "evening" | null;
  preferredTime?: string | null;
  slotChoice?: number | null;
  identifiedTreatment: string | null;
  // Preenchido quando o termo do lead é genérico e corresponde a 2+ tratamentos
  // (ex: variações/técnicas de um mesmo procedimento) sem que o lead tenha
  // especificado qual delas. identifiedTreatment fica null nesse caso.
  ambiguousTreatmentMatches: string[] | null;
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
  | "needs_human"             // requer ação humana: pede mídia, negociação, falar com especialista, situação especial
  | "patient_arrived"         // paciente avisa que chegou à clínica ou que vai se atrasar para consulta agendada
  | "general_question"        // pergunta geral sobre a clínica
  | "greeting"                // primeiro contato genuíno, sem histórico relevante
  | "acknowledgment"          // reconhecimento mid-conversa: "ok", "blz", "entendi", "certo"
  | "farewell"                // encerramento: "obrigado tchau", "valeu", "até mais"
  | "stop_contact"            // opt-out: pede para não receber mais mensagens/sair da lista
  | "unclear";                // não foi possível entender

export type IntentClassification = {
  intent: IntentType;
  slotPreference: SlotPreference;
  confidence: number;
  shouldAskClarification: boolean;
  clarificationQuestion?: string | null;
  handoffReason?: string | null;
};

function buildBaseSystemPrompt(context: PromptContext): string {
  const clinicSpecificRules = context.isClinicSegment ? `
REGRA PARA patient_arrived (PRIORIDADE ALTA — avalie antes de unclear e antes de acknowledgment):
Use "patient_arrived" quando o ${context.contactNoun} indica presença física na clínica ou avisa sobre chegada/atraso para uma ${context.bookingNoun} agendada. Exemplos:
- Chegada: "cheguei", "já estou aí", "estou na recepção", "estou esperando", "cheguei antes do horário", "já estou no consultório", "estou na porta", "estou aqui"
- Atraso: "vou me atrasar", "chego uns 10 minutos atrasado", "estou no caminho", "chego em X minutos", "ainda não saí mas já saio"
- Confirmação de presença: "só confirmando que estarei aí", "estarei no horário", "confirmo minha presença"
- Não use quando o ${context.contactNoun} está pedindo para agendar, cancelar ou remarcar — nesses casos use o intent específico.

REGRA PARA clinical_urgency (PRIORIDADE ALTA — avalie antes de unclear):
Use "clinical_urgency" quando o lead relatar dor, urgência médica OU problema físico com trabalho odontológico já realizado. Exemplos:
- Dor/urgência: "dor", "urgência", "emergência", "urgente", "está doendo", "dor forte"
- Problema com trabalho existente: "trincou", "quebrou", "fraturou", "caiu a lente", "soltou o dente", "a prótese caiu", "a restauração caiu", "a coroa soltou", "está lascado", "está rachado", "soltou o implante"
- Use clinical_urgency nesses casos mesmo que o lead não mencione dor — um trabalho físico danificado requer avaliação presencial urgente.
` : "";

  return `Você é um classificador de intenções para um(a) ${context.agentRole} de ${context.businessDescriptor}.

Sua única função é analisar a última mensagem do lead e retornar um JSON estruturado com a intenção detectada.

REGRAS GERAIS:
- Analise SEMPRE no contexto da conversa anterior
- Se o lead mandou "1", "2" ou "3" e há contexto de oferta de horários → intent = "confirm_slot" com slotChoice = número
- Se o lead disse "pode ser", "esse", "quero esse", "tá bom" após oferta → intent = "confirm_slot"
- "nenhum desses", "outro horário", "não tenho disponibilidade" → intent = "reject_slots"
- "quanto custa", "qual o valor", "tem plano" → intent = "price_inquiry"
- "dor", "urgência", "emergência", "urgente" → intent = "clinical_urgency"

REGRA CRÍTICA — nome de serviço SEM intenção de agendar → "general_question":
- "book_appointment" exige INTENÇÃO EXPLÍCITA de agendar: palavras como "marcar", "agendar", "reservar", "quero fazer", "quero agendar", "pode marcar", "queria agendar".
- Quando o lead menciona um serviço SEM nenhuma dessas palavras (ex: "quero saber sobre X", "me fala de Y", "o que é Z") → intent = "general_question", NÃO "book_appointment".
- Isso vale mesmo que o serviço esteja na lista de procedimentos da clínica.
- Exemplos de "general_question": mencionar nome de um serviço sem intenção de agendar, "como funciona?", "quanto tempo dura?", "tem risco?", "qual a diferença entre X e Y?".
- Exemplos de "book_appointment": "quero agendar X", "pode marcar um horário para Y", "quero fazer Z".

REGRAS CRÍTICAS PARA ENCERRAMENTO E RECONHECIMENTO:
- "opa blz", "blz", "ok", "entendi", "certo", "tá", "tá bom", "legal", "bacana", "perfeito", "combinado", "show" quando há histórico de conversa → intent = "acknowledgment"
- "obrigado" isolado após receber informação (ex: após receber resposta sobre preço, formas de pagamento, procedimentos) → intent = "acknowledgment"
- "obrigado" + sinal de encerramento ("tchau", "até mais", "até logo", "valeu", "certo obrigado", "ok obrigado", "tá obrigado") → intent = "farewell"
- "tchau", "até mais", "até logo", "até breve", "foi um prazer", "a gente se fala" → intent = "farewell"
- Mensagem vaga/ambígua que não tem conteúdo de negócio (ex: "esse é o normal", "né", "é") quando há contexto de conversa → intent = "acknowledgment" (não é unclear)

REGRA PARA stop_contact (opt-out — PRIORIDADE ALTA, avalie antes de farewell/unclear):
- Use "stop_contact" SOMENTE quando o lead pede claramente para PARAR DE RECEBER MENSAGENS ou sair de contato/lista. Exemplos: "não quero mais receber mensagens", "para de me mandar mensagem", "me tira dessa lista", "não me manda mais nada", "quero cancelar o recebimento", "descadastrar", "sair da lista", "pare de me enviar", "não me chame mais aqui".
- NÃO confundir com rejeição pontual dentro do fluxo:
  - "não quero esse horário", "nenhum desses" → reject_slots (é sobre slots, não sobre contato)
  - "não quero mais fazer o tratamento", "desisti do procedimento" → NÃO é stop_contact (é desistência de compra; siga o fluxo normal)
  - "não", "não obrigado", "agora não" isolados → acknowledgment ou o intent do contexto, NÃO stop_contact
  - "tchau", "valeu" → farewell (encerrar a conversa ≠ pedir para nunca mais ser contatado)
- Na dúvida entre stop_contact e farewell/reject_slots, só escolha stop_contact se houver menção explícita a NÃO RECEBER MAIS mensagens/contato.

REGRA PARA greeting:
- intent = "greeting" SOMENTE quando é genuinamente o primeiro contato sem histórico OU quando o lead recomeça do zero com nova saudação após longa ausência
- "oi", "olá", "bom dia", "boa tarde" COM histórico de conversa ativo → intent = "acknowledgment", NÃO "greeting"

REGRA CRÍTICA — confirm_slot com data diferente dos slots oferecidos:
- Se há oferta de horários pendente E o lead menciona um dia/data DIFERENTE dos slots que foram oferecidos no histórico → intent = "reject_slots" com preferredDate extraída, NÃO "confirm_slot"
- Exemplo: slots oferecidos são "Seg 01/06" mas lead diz "segunda feira dia 08/06" → intent = "reject_slots", preferredDate = "08/06"
- "confirm_slot" SOMENTE quando o lead escolhe pelo número (1, 2, 3) OU aceita claramente um dos dias já oferecidos sem mencionar outra data

REGRA PARA needs_human (PRIORIDADE ALTA — avalie antes de unclear):
Use "needs_human" quando o lead pedir algo que só um humano pode entregar ou decidir. Exemplos:
- Documentos/comprovantes: "pode enviar o orçamento por escrito", "me manda o comprovante", "me envia o resultado"
- Fotos/vídeos PESSOAIS do resultado do cliente específico: "quero ver o antes e depois do meu caso", "tem foto de como vai ficar no meu caso"
- EXCEÇÃO IMPORTANTE — pedido de fotos/vídeos DOS SERVIÇOS DA CLÍNICA (material de marketing já disponível): "tem foto do serviço?", "tem vídeo do tratamento?", "pode me mostrar como fica?", "tem algum exemplo de resultado?" → NÃO é needs_human → classifique como "general_question" (a IA tem acesso à biblioteca de mídia e pode enviar diretamente)
- Falar com humano: "quero falar com um especialista", "preciso falar com alguém", "pode me ligar?", "me passa o número do responsável"
- Negociação/exceção: "preciso de um desconto", "tem como parcelar diferente?", "tenho uma situação especial", "consigo condição especial?"
- Acordo/troca informal: lead propõe permuta de serviços, menciona combinado anterior com a equipe ou situação negociada fora do fluxo padrão — qualquer proposta de troca ou referência a acordo pessoal com a clínica.
- Manutenção de trabalho JÁ REALIZADO: lead pergunta preço/condições de um serviço aplicado a um procedimento existente (ex: "polimento nas lentes", "ajuste na prótese", "reparo na restauração", "manutenção do aparelho") e esse serviço NÃO consta na lista de procedimentos → needs_human com handoffReason descrevendo o serviço pedido. Restrição logística (mora longe, quer tudo no mesmo dia) reforça o caso, mas NÃO é obrigatória.
- Quando needs_human, preencha handoffReason com uma frase curta descrevendo o que o lead pediu (ex: "Lead pediu fotos do resultado pessoal", "Lead quer falar com especialista", "Lead pediu condição especial de pagamento", "Lead propôs acordo de troca de serviços", "Paciente pós-procedimento — preços de manutenção e restrição logística"). Máximo 60 caracteres.

EXCEÇÃO CRÍTICA — primeiro contato via anúncio: Se o CONTEXTO indicar que o(a) ${context.agentRole} ainda não respondeu nesta conversa (primeiro contato), frases como "há alguém disponível para conversar?", "tem alguém atendendo?", "posso falar com alguém?", "tem atendimento?" são aberturas naturais de quem clicou em um anúncio do WhatsApp — NÃO são pedidos para falar com um especialista específico. Neste caso: (a) se a mensagem contém uma pergunta real de produto ou serviço, use o intent correspondente (price_inquiry, general_question, etc.); (b) se não contém outra pergunta específica, use "greeting". Só use needs_human em primeiro contato quando o lead pedir explicitamente algo que só um humano pode entregar (documento, foto pessoal, desconto, condição especial).

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
- Cada procedimento da lista pode vir acompanhado de "também chamado de: ...", com termos leigos/sinônimos usados por pacientes reais (ex: "dentadura" para prótese dentária, "canal" para tratamento de canal). Use SEMPRE esses sinônimos como correspondência válida e prioritária — são mais confiáveis que sua própria inferência.
- Se o lead mencionar algo que claramente corresponde a um procedimento da lista (por nome ou sinônimo) → retorne o nome exato da lista.
- EXCEÇÃO — SERVIÇO APLICADO A UM PROCEDIMENTO ≠ O PROCEDIMENTO: se a pergunta é sobre uma ação de manutenção sobre trabalho já feito (polimento, retoque, reparo, conserto, troca, ajuste — ex: "polimento nas lentes"), o procedimento citado é apenas o CONTEXTO. NÃO retorne o procedimento base como identifiedTreatment; retorne null (e avalie a regra de manutenção em needs_human).
- EXCEÇÃO — "avaliação": Se o lead pedir "avaliação" (mesmo que cite um procedimento, ex: "avaliação para lentes", "avaliação de implante"), procure na lista um procedimento que contenha "avaliação" ou "avaliaç". Se encontrar, retorne o nome exato desse procedimento de avaliação. Se NÃO encontrar procedimento de avaliação na lista, retorne null — "avaliação" não é equivalente ao procedimento principal.
- Se o lead mencionar algo que NÃO corresponde a nenhum procedimento da lista → retorne null e use shouldAskClarification: true.
- Se o lead não mencionou nenhum procedimento (ex: "quero marcar uma consulta" sem especificar qual) → retorne null.
- Extraia identifiedTreatment para intent = "book_appointment", "check_availability", "price_inquiry" e "general_question". Para perguntas comparativas ("qual é melhor X ou Y?"), extraia o tratamento principal sobre o qual o lead parece mais interessado, ou o primeiro mencionado. Para outros intents, retorne null.

REGRA PARA ambiguousTreatmentMatches (AMBIGUIDADE ENTRE VARIAÇÕES DO MESMO PROCEDIMENTO):
- Alguns procedimentos da lista são variações/técnicas de uma mesma família (ex: duas entradas diferentes para a versão "simplificada" e a versão "estratificada"/"premium" do mesmo tratamento).
- Se o termo usado pelo lead for GENÉRICO e corresponder a 2 OU MAIS procedimentos da lista (por nome ou sinônimo), e o lead NÃO tiver especificado qual variação/técnica quer → retorne identifiedTreatment: null e preencha ambiguousTreatmentMatches com os nomes exatos de TODOS os procedimentos que correspondem.
- Se o lead especificou claramente qual variação (citou o nome da técnica, ou termo que só corresponde a uma delas) → retorne essa em identifiedTreatment e ambiguousTreatmentMatches: null.
- Em qualquer outro caso (correspondência única ou nenhuma correspondência) → ambiguousTreatmentMatches: null.

REGRA PARA NEGAÇÃO DE PROCEDIMENTO (evite grudar no assunto errado):
- Se o lead usar negação explícita sobre um procedimento mencionado anteriormente pela IA (ex: "não é lentes", "não quero isso", "não é isso que eu preciso") → NÃO retorne esse procedimento negado como identifiedTreatment, mesmo que ele apareça no histórico recente.
- Se a mesma mensagem mencionar outro procedimento (ex: "não é lentes, seria uma dentadura") → identifique o NOVO procedimento mencionado, usando a lista de sinônimos.
- Se a negação não vier acompanhada de um novo procedimento claro → retorne identifiedTreatment: null e shouldAskClarification: true, para que a próxima pergunta descubra o que o lead realmente quer — NUNCA assuma que o procedimento antigo continua valendo.

Retorne APENAS JSON válido, sem markdown, sem explicação.
${clinicSpecificRules}`;
}

function buildSystemPrompt(treatments: TreatmentOption[], context: PromptContext): string {
  const base = buildBaseSystemPrompt(context);
  if (treatments.length === 0) return base;
  const label = context.serviceNoun === "tratamento" ? "CLÍNICA" : "EMPRESA";
  const list = treatments
    .map((t) => {
      const aliases = t.aliases?.filter(Boolean) ?? [];
      return aliases.length > 0
        ? `  - ${t.name} (também chamado de: ${aliases.join(", ")})`
        : `  - ${t.name}`;
    })
    .join("\n");
  return `${base}\n\nSERVIÇOS DISPONÍVEIS NESTA ${label}:\n${list}`;
}

// strict: true exige que todo campo em properties conste em required.
// Campos opcionais são declarados como anyOf [type, null].
export const RESPONSE_SCHEMA = {
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
        "stop_contact",
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
        ambiguousTreatmentMatches: {
          anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
        },
      },
      required: [
        "preferredDate",
        "preferredPeriod",
        "preferredTime",
        "slotChoice",
        "identifiedTreatment",
        "ambiguousTreatmentMatches",
      ],
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
    treatments: TreatmentOption[] = [],
    context: PromptContext = {
      agentRole: "recepcionista virtual",
      serviceNoun: "tratamento",
      bookingNoun: "consulta",
      contactNoun: "paciente",
      businessDescriptor: "clínica",
      isClinicSegment: true,
    },
  ): Promise<IntentClassification> {
    // Contexto resumido da conversa (últimas 8 mensagens para economizar tokens)
    const recentHistory = conversationHistory.slice(-8);
    const historyText = recentHistory
      .map((m) => {
        const role = m.author === "lead" ? "Lead" : context.agentRole.charAt(0).toUpperCase() + context.agentRole.slice(1);
        return `${role}: ${m.body}`;
      })
      .join("\n");

    // Primeiro contato: nenhuma mensagem de agente/clínica no histórico ainda.
    // Frases de disponibilidade ("há alguém?") são aberturas de anúncio, não pedidos de handoff.
    const isFirstContact = conversationHistory.every((m) => m.author === "lead");

    const userContent = [
      isFirstContact
        ? `CONTEXTO: Primeiro contato deste lead — o(a) ${context.agentRole} ainda não respondeu nesta conversa. Frases de disponibilidade ('há alguém disponível?', 'tem alguém atendendo?') são aberturas naturais de anúncio, não pedidos de handoff humano.`
        : "",
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
        { role: "system", content: buildSystemPrompt(treatments, context) },
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
          ambiguousTreatmentMatches: null,
        },
        confidence: 0,
        shouldAskClarification: true,
        clarificationQuestion: "Pode me contar mais sobre o que você precisa?",
      };
    }
  }
}
