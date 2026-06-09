// LLM Estágio 2: Humaniza o resultado de uma ação já executada.
// NUNCA inventa horários ou dados. Recebe fatos concretos e verbaliza em tom humano.
// Separado do IntentClassifier para garantir que lógica e linguagem não se misturem.

import OpenAI from "openai";
import type { Message } from "@/domain/entities/conversation";
import type { FormattedSlot } from "@/core/conversation/ConversationStateMachine";
import type { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import type { ConversationExperience } from "@/domain/entities/clinic";
import { DEFAULT_CONVERSATION_EXPERIENCE } from "@/domain/entities/clinic";

const MODEL = "gpt-4o-mini";
const PROMPT_VERSION = "composer-v2-experience";
const OPENAI_TIMEOUT_MS = 30_000;

export type FormattedAppointment = {
  label: string;   // "Seg 26/05 às 14h"
  status: string;  // "scheduled" | "confirmed"
};

export type ActionResult =
  | {
      type: "slots_found";
      slots: FormattedSlot[];
      askedForPreference: boolean; // se true, LLM perguntou período antes
    }
  | { type: "appointment_confirmed"; slot: FormattedSlot; clinicName: string; clinicAddress?: string | null }
  | { type: "appointment_cancelled"; count?: number }
  | { type: "appointment_rescheduled"; newSlots: FormattedSlot[] }
  | { type: "no_slots_available"; nextAvailableDate?: string; alternativeSlots?: FormattedSlot[] }
  | { type: "clarification_needed"; question: string }
  | { type: "appointments_listed"; appointments: FormattedAppointment[] }
  | { type: "no_appointments" }
  | { type: "clinical_urgency" }
  | { type: "handoff_requested"; handoffReason?: string | null }
  | { type: "price_inquiry" }
  | { type: "general_question"; clinicContext: string }
  | { type: "greeting" }
  | { type: "acknowledgment" }
  | { type: "farewell" }
  | { type: "slots_expired"; freshSlots: FormattedSlot[] }
  | { type: "slot_taken_reoffered"; newSlots: FormattedSlot[] }
  | { type: "reengagement"; lastAppointmentLabel: string }
  | { type: "appointment_reminder"; appointmentLabel: string }
  | { type: "evaluation_redirect"; treatmentName: string; evaluationSlots: FormattedSlot[] }
  | { type: "patient_arrived"; appointmentTime: Date | null }
  | { type: "media_received"; mediaType: "image" | "video" | "document" }
  | { type: "video_sent_followup"; videoTitle: string };

export type ComposerInput = {
  actionResult: ActionResult;
  conversationHistory: Message[];
  clinic: {
    name: string;
    specialty: string;
    toneOfVoice: string | null;
    playbook: string | null;
    receptionistName?: string;
    commercialPolicy: string | null;
    installmentTable?: string | null;
    mediaLibrary?: { id: string; title: string; type: "video" | "image" }[];
  };
  leadName?: string | null;
  timezone: ClinicTimezone;
  isFirstMessage: boolean;
  conversationExperience?: ConversationExperience;
  resumedFromHumanTakeover?: boolean;
};

export type ComposedResponse = {
  text: string;
  mediaId: string | null;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
};

function buildSystemPrompt(input: ComposerInput): string {
  const { clinic, leadName, timezone, isFirstMessage, resumedFromHumanTakeover } = input;
  const conversationExperience = input.conversationExperience ?? DEFAULT_CONVERSATION_EXPERIENCE;
  const nowStr = timezone.formatNowForPrompt();
  const experienceRules = conversationExperience === "concierge"
    ? `MODO DE EXPERIÊNCIA: concierge.
- Responda primeiro ao que o lead escreveu; menu é fallback, não ponto de partida.
- Não encerre com "digite menu" ou variações, a menos que o lead tenha pedido o menu.
- Se o lead perguntou preço, pagamento, lentes ou tratamento, responda a dúvida e conduza para avaliação apenas quando fizer sentido.
- Máximo 1 pergunta no final. A pergunta deve ter objetivo claro.`
    : `MODO DE EXPERIÊNCIA: menu-first.
- O menu pode ser usado para saudações genéricas, pedidos de menu ou entradas confusas.
- Se o lead fez uma pergunta clara, responda a intenção antes de oferecer qualquer menu.
- Não repita o menu depois de responder preço, pagamento, endereço ou tratamento.
- Máximo 1 pergunta no final.`;

  return `Você é a ${clinic.receptionistName ?? "Mariana"}, recepcionista virtual da ${clinic.name}, uma clínica de ${clinic.specialty}.

IDENTIDADE:
- Tom de voz: ${clinic.toneOfVoice ?? "informal e acolhedor"}
- ${leadName ? `Nome do lead: ${leadName}` : "Nome do lead: desconhecido (não invente)"}
- Data/hora atual: ${nowStr}
${isFirstMessage ? `- É a primeira mensagem: mencione o nome da clínica uma vez` : "- Não mencione o nome da clínica novamente"}

REGRA ANTI-REPETIÇÃO (OBRIGATÓRIA — leia antes de redigir):
Verifique o histórico da conversa. Se alguma informação já foi comunicada ao lead (ex: valor da avaliação, condições de parcelamento, endereço, formas de pagamento), NÃO repita — mesmo que a ação abaixo sugira mencioná-la. Só repita se o lead perguntar novamente de forma explícita.

REGRAS ABSOLUTAS:
1. Máximo 2 parágrafos curtos. Sem bullet points exceto quando a instrução da ação indicar FORMATO: tópicos. Escreva como pessoa real.
2. NUNCA invente horários, datas ou informações que não estão no contexto fornecido.
3. Se houver horários disponíveis na ação, os mencione EXATAMENTE como fornecidos — não reformule datas.
4. Use o nome do lead com naturalidade, não em toda frase.
5. Não use emojis em excesso — no máximo 1 por mensagem e só se o tom for informal.
6. Saudações: se a mensagem atual do lead começar com uma saudação temporal ("bom dia", "boa tarde", "boa noite", "oi", "olá"), espelhe-a naturalmente na abertura da resposta. Não adicione saudações espontaneamente no meio de uma conversa em que o lead não cumprimentou.
7. FIDELIDADE EDITORIAL: se a política comercial ou as orientações da clínica exigirem valores, condições, nomes de técnicas ou limites explícitos para o assunto perguntado, preserve esses dados na resposta. Não resuma removendo preços, quantidades ou condições autorizadas.

${experienceRules}

ESCOPO ESTRITO: Você responde SOMENTE sobre assuntos da ${clinic.name} — agendamentos, especialidades, localização, preços e tratamentos. Para perguntas completamente fora do escopo da clínica (política, outros serviços, programação, etc.), responda gentilmente que você é a recepcionista virtual e pode ajudar apenas com assuntos da clínica.
${clinic.commercialPolicy ? `\nPOLÍTICA COMERCIAL:\n${clinic.commercialPolicy}` : ""}
${clinic.playbook ? `\nORIENTAÇÕES DA CLÍNICA:\n${clinic.playbook}` : ""}
${clinic.mediaLibrary && clinic.mediaLibrary.length > 0 ? `
BIBLIOTECA DE MÍDIA DISPONÍVEL PARA ENVIAR AO LEAD:
${clinic.mediaLibrary.map((m) => `• [${m.type === "video" ? "VÍDEO" : "FOTO"}] id="${m.id}" — ${m.title}`).join("\n")}
INSTRUÇÃO: Se enviar uma dessas mídias for genuinamente útil neste momento (lead pediu detalhes, quer ver como fica, perguntou sobre o procedimento específico), adicione exatamente ao final da sua resposta (sem espaço após o texto): [MEDIA:id_aqui]
Exemplo: "...agende sua avaliação! [MEDIA:abc-123]"
Envie no máximo 1 mídia por resposta. Não envie se não for diretamente relevante.` : ""}
${resumedFromHumanTakeover ? `
ATENÇÃO — RETOMADA APÓS ATENDIMENTO HUMANO:
Um membro da equipe da ${clinic.name} atendeu esta conversa diretamente por um período. Leia com atenção as mensagens anteriores — especialmente as do operador — antes de responder. Continue a conversa de forma natural a partir do ponto onde parou: não recomece com saudações, não repita informações já fornecidas pelo operador, e não aja como se fosse o início de uma nova conversa. Se o operador já encaminhou algo (agendamento, informação, proposta), leve isso em conta na sua resposta.` : ""}`;
}

export function buildActionContext(
  result: ActionResult,
  conversationExperience: ConversationExperience = DEFAULT_CONVERSATION_EXPERIENCE,
  installmentTable?: string | null,
): string {
  const isConcierge = conversationExperience === "concierge";

  switch (result.type) {
    case "slots_found": {
      const slotList = result.slots.map((s) => `${s.index}. ${s.label}`).join("\n");
      return `AÇÃO EXECUTADA: Encontramos horários disponíveis.
REGRA CRÍTICA: Use EXATAMENTE os labels abaixo. NÃO altere datas, horas ou dias. NÃO use horários do histórico da conversa.
FORMATO OBRIGATÓRIO PARA HORÁRIOS: liste cada opção em linha separada, numerada (exceção permitida à regra geral). Uma frase curta de introdução, depois a lista, depois peça que o lead responda com o número. Ao final, em uma linha separada, informe que esses horários ficam disponíveis por 15 minutos aguardando a resposta.
HORÁRIOS DISPONÍVEIS:
${slotList}`;
    }

    case "appointment_confirmed":
      return `AÇÃO EXECUTADA: Agendamento confirmado com sucesso.
HORÁRIO CONFIRMADO: ${result.slot.label}
CLÍNICA: ${result.clinicName}${result.clinicAddress ? `\nENDEREÇO: ${result.clinicAddress}` : ""}
Informe o lead de forma calorosa. Mencione o horário confirmado e, se houver endereço acima, inclua-o na mensagem. Diga que a equipe estará esperando. Não peça confirmação novamente.`;

    case "appointment_cancelled": {
      const qty = result.count && result.count > 1 ? `${result.count} agendamentos` : "o agendamento";
      return `AÇÃO EXECUTADA: ${qty} cancelado(s) com sucesso. NÃO mencione horários específicos — apenas confirme o cancelamento de forma gentil e deixe a porta aberta para um novo agendamento.`;
    }

    case "appointment_rescheduled": {
      const slotList = result.newSlots.map((s) => `${s.index}. ${s.label}`).join("\n");
      return `AÇÃO EXECUTADA: Agendamento anterior cancelado. Apresente os novos horários disponíveis.
REGRA CRÍTICA: Use EXATAMENTE os labels abaixo. NÃO altere datas, horas ou dias. NÃO use horários do histórico da conversa.
FORMATO OBRIGATÓRIO PARA HORÁRIOS: liste cada opção em linha separada, numerada (exceção permitida à regra geral). Uma frase curta de introdução, depois a lista, depois peça que o lead responda com o número. Ao final, em uma linha separada, informe que esses horários ficam disponíveis por 15 minutos aguardando a resposta.
NOVOS HORÁRIOS:
${slotList}`;
    }

    case "no_slots_available": {
      const altSection = result.alternativeSlots?.length
        ? `\nALTERNATIVAS DE OUTROS DIAS:\n${result.alternativeSlots.map((s) => `- ${s.label}`).join("\n")}\nApresente estas opções SOMENTE se o lead demonstrar abertura para outros dias, listando cada uma em linha separada (exceção permitida à regra geral). Se insistir no dia original, informe com empatia que não há disponibilidade e diga que a equipe entrará em contato.`
        : "Ofereça alternativas ou peça para o lead sugerir outro período.";
      return `AÇÃO EXECUTADA: O dia/horário solicitado não tem disponibilidade.
${result.nextAvailableDate ? `Próximo horário disponível: ${result.nextAvailableDate}` : ""}
Informe com clareza e empatia que o dia pedido não tem horários disponíveis.
${altSection}`;
    }

    case "clarification_needed":
      return `AÇÃO EXECUTADA: Precisamos de mais informações.
PERGUNTA A FAZER: ${result.question}
Faça a pergunta de forma natural e acolhedora.`;

    case "appointments_listed": {
      const apptList = result.appointments.map((a) => `  - ${a.label}`).join("\n");
      return `AÇÃO EXECUTADA: Listamos os agendamentos do lead.
AGENDAMENTOS:
${apptList}
Apresente-os de forma clara e pergunte se pode ajudar com mais alguma coisa.`;
    }

    case "no_appointments":
      return `AÇÃO EXECUTADA: Lead não tem agendamentos ativos.
Informe gentilmente e ofereça agendar uma avaliação.`;

    case "clinical_urgency":
      return `AÇÃO EXECUTADA: Detectada urgência clínica.
Demonstre empatia, informe que irá acionar a equipe imediatamente e diga que alguém entrará em contato. Não minimize a situação.`;

    case "handoff_requested": {
      const context = result.handoffReason
        ? `O lead pediu: "${result.handoffReason}". Reconheça o pedido especificamente — não seja genérico.`
        : "Informe que um membro da equipe irá assumir o atendimento em breve.";
      return `AÇÃO EXECUTADA: Este pedido requer atendimento humano — a IA não pode cumprir.
${context}
REGRAS: Seja caloroso e específico. Diga que a equipe já foi avisada e irá responder em breve. Máximo 2 frases. NÃO diga que vai "verificar" — diga que já avisou a equipe.`;
    }

    case "price_inquiry": {
      const installmentInstruction = installmentTable
        ? `SE O LEAD PERGUNTAR SOBRE PARCELAMENTO: use a TABELA DE PARCELAMENTO abaixo — os valores já incluem a taxa da operadora, apresente-os diretamente sem mencionar taxa adicional.\n${installmentTable}`
        : `SE O LEAD PERGUNTAR SOBRE PARCELAMENTO (ex: "12x quanto fica?", "parcela em quantas vezes?"): calcule a parcela base (valor ÷ número de parcelas), apresente como "Nx de R$X — a taxa da maquininha fica com a operadora, não entra no valor da clínica 😊". NÃO invente uma porcentagem de taxa.`;
      return `AÇÃO EXECUTADA: Lead perguntou sobre preço.
Apresente os valores e condições descritos na política comercial do sistema. REGRA CRÍTICA: se o lead perguntar sobre um serviço ou valor que a política NÃO menciona, reconheça a pergunta com empatia e explique que a clínica disponibiliza valores apenas para os procedimentos descritos — qualquer outra informação de preço pode ser obtida diretamente com a equipe. NÃO invente valores nem diga "não temos" para serviços não listados.
${installmentInstruction}
SE O LEAD MENCIONAR UM PREÇO QUE VIU EM OUTRO LUGAR ("minha amiga pagou X", "vi em outro lugar por Y"): reconheça com empatia sem ser defensivo; mencione brevemente que técnica, material e experiência do profissional influenciam o resultado — sem criticar concorrentes.
SE O LEAD MENCIONAR QUE ESTÁ COMPRANDO PARA OUTRA PESSOA ("meu marido", "minha esposa", "quero presentear"): trate com naturalidade; fale sobre o procedimento como se o destinatário fosse o paciente; sugira a avaliação presencial para que o dentista avalie o caso do paciente real.
${isConcierge ? "Depois de responder, conduza para a avaliação com uma pergunta leve quando houver interesse real." : "Depois de responder, ofereça um próximo passo objetivo; não reapresente o menu."}`;
    }

    case "general_question":
      return `AÇÃO EXECUTADA: Pergunta geral sobre a clínica.
CONTEXTO DA CLÍNICA: ${result.clinicContext}
Responda de forma informativa e acolhedora. ${isConcierge ? "Se a dúvida indicar interesse comercial, conduza para avaliação de forma natural." : "Não reapresente menu quando a pergunta do lead for clara."}`;


    case "greeting":
      return `AÇÃO EXECUTADA: Lead enviou saudação — primeiro contato ou reinício de conversa.
Use a saudação temporal correta com base no HORÁRIO ATUAL indicado no sistema: entre 05h e 12h → "Bom dia", entre 12h e 18h → "Boa tarde", fora desse intervalo (incluindo madrugada) → "Boa noite". Se o nome do lead estiver disponível no sistema, inclua-o logo após a saudação (ex: "Boa tarde, João!"). Seja caloroso, se apresente brevemente se for o primeiro contato e pergunte como pode ajudar. Se há histórico de conversa, apenas cumprimente e continue — não reinicie do zero.`;

    case "acknowledgment":
      return `AÇÃO EXECUTADA: Lead enviou reconhecimento mid-conversa ("ok", "blz", "entendi", "certo", "obrigado" após info) ou saudação isolada com histórico ativo.
REGRA PRIORITÁRIA: se a última mensagem do lead for EXATAMENTE uma saudação temporal ("bom dia", "boa tarde", "boa noite"), OBRIGATORIAMENTE comece a resposta com a mesma saudação (ex: "Boa tarde! Estarei por aqui."). Saudações genéricas como "oi", "olá", "ei", "hey" NÃO são saudações temporais — não adicione "Bom dia/Boa tarde/Boa noite" nesse caso.
Nos demais casos, responda com UMA frase curta e calorosa SEM saudação temporal. NÃO faça perguntas. NÃO use "Como posso ajudar?". NÃO reinicie a conversa.`;

    case "farewell":
      return `AÇÃO EXECUTADA: Lead está encerrando a conversa ("obrigado tchau", "até mais", "valeu", "certo obrigado").
Responda com despedida calorosa em UMA frase. Deixe a porta aberta para contato futuro. NÃO ofereça serviços agora. NÃO pergunte "posso ajudar em algo mais?". Exemplos: "Foi um prazer! Se precisar de qualquer coisa, estarei por aqui 😊", "Até logo! Qualquer dúvida, é só chamar."`;

    case "slots_expired": {
      const slotList = result.freshSlots.map((s) => `${s.index}. ${s.label}`).join("\n");
      return `AÇÃO EXECUTADA: A oferta de horários expirou (lead demorou para responder).
Informe gentilmente que o horário reservado não está mais disponível e apresente estes novos horários disponíveis.
REGRA CRÍTICA: Use EXATAMENTE os labels abaixo. NÃO altere datas, horas ou dias.
FORMATO OBRIGATÓRIO PARA HORÁRIOS: liste cada opção em linha separada, numerada (exceção permitida à regra geral). Uma frase curta de introdução, depois a lista, depois peça que o lead responda com o número.
NOVOS HORÁRIOS:
${slotList}`;
    }

    case "slot_taken_reoffered": {
      const slotList = result.newSlots.map((s) => `${s.index}. ${s.label}`).join("\n");
      return `AÇÃO EXECUTADA: O horário escolhido ficou indisponível — outro paciente acabou de reservá-lo.
NÃO confirme o agendamento. NÃO diga que o horário foi marcado. Informe com empatia que aquele horário foi ocupado agora e apresente estas novas opções disponíveis.
REGRA CRÍTICA: Use EXATAMENTE os labels abaixo. NÃO altere datas, horas ou dias.
FORMATO OBRIGATÓRIO PARA HORÁRIOS: liste cada opção em linha separada, numerada (exceção permitida à regra geral). Uma frase curta de introdução, depois a lista, depois peça que o lead responda com o número.
NOVOS HORÁRIOS:
${slotList}`;
    }

    case "reengagement":
      return `AÇÃO EXECUTADA: Mensagem de re-engajamento para paciente com histórico na clínica.
ÚLTIMA CONSULTA: ${result.lastAppointmentLabel}
Envie uma mensagem calorosa e breve lembrando que pode estar na hora de agendar um retorno ou verificar se pode ajudar. Não mencione que a mensagem é automática. Máximo 2 frases.`;

    case "evaluation_redirect": {
      const slotList = result.evaluationSlots.map((s) => `${s.index}. ${s.label}`).join("\n");
      return `AÇÃO EXECUTADA: O procedimento solicitado (${result.treatmentName}) requer uma avaliação presencial antes do agendamento completo.
REGRA CRÍTICA: Use EXATAMENTE os labels dos horários abaixo. NÃO altere datas, horas ou dias.
FORMATO OBRIGATÓRIO: uma frase curta explicando que a avaliação é o primeiro passo para ${result.treatmentName}, depois a lista numerada de horários disponíveis, depois peça que o lead responda com o número.
HORÁRIOS PARA AVALIAÇÃO:
${slotList}`;
    }

    case "patient_arrived": {
      const apptContext = result.appointmentTime
        ? `Há uma consulta agendada para hoje às ${result.appointmentTime.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}.`
        : "Não há registro de consulta hoje para este paciente.";
      return `AÇÃO EXECUTADA: Paciente avisou chegada ou presença para consulta.
${apptContext}
REGRAS OBRIGATÓRIAS:
1. Seja extremamente acolhedor e tranquilizador — o paciente está fisicamente presente.
2. Confirme que a equipe já foi avisada e que será atendido em breve.
3. NÃO ofereça menu, NÃO ofereça agendamento, NÃO faça perguntas.
4. Máximo 2 frases curtas e calorosas.
Exemplo de tom: "Olá! Já avisamos a equipe sobre sua chegada — em instantes você será atendido 😊"`;
    }

    case "media_received": {
      const artigo = result.mediaType === "image" ? "a foto" : result.mediaType === "video" ? "o vídeo" : "o arquivo";
      const recebido = result.mediaType === "image" ? "Recebi sua foto" : result.mediaType === "video" ? "Recebi seu vídeo" : "Recebi seu arquivo";
      return `AÇÃO EXECUTADA: Lead enviou ${artigo} para avaliação pelo especialista.
${recebido}! Informe acolhedoramente que ${artigo} foi recebido(a) e que o especialista irá avaliar o caso pessoalmente. Diga que a equipe retorna em breve com orientações. Máximo 2 frases. Tom caloroso e profissional. NÃO peça mais fotos. NÃO dê diagnóstico. NÃO mencione prazo específico que não possa cumprir.`;
    }

    case "video_sent_followup":
      return `AÇÃO EXECUTADA: Re-engajamento específico para lead que recebeu um vídeo e não respondeu.
VÍDEO ENVIADO: ${result.videoTitle}
REGRAS OBRIGATÓRIAS:
1. Não mencione que é uma mensagem automática.
2. Seja breve, caloroso e curiosa — máximo 2 frases.
3. Pergunte o que o lead achou do vídeo de forma natural.
4. Ofereça verificar horários disponíveis para o lead conhecer pessoalmente o resultado.
5. Não use emojis. Escreva em prosa, como se estivesse falando.
Exemplo de tom: "Oi! Conseguiu ver o vídeo sobre as lentes? O Dr. Gregorie tem horários disponíveis essa semana — posso verificar um para você."`;

    case "appointment_reminder":
      return `AÇÃO EXECUTADA: Lembrete de consulta agendada para amanhã.
CONSULTA: ${result.appointmentLabel}
REGRAS OBRIGATÓRIAS:
1. Mencione o horário EXATAMENTE como fornecido em CONSULTA — não reformule.
2. Seja caloroso, breve e direto. Máximo 2 frases curtas.
3. Não peça confirmação (a consulta já está confirmada). Apenas lembre.
4. Não mencione que a mensagem é automática.
5. Inclua um toque humano — transmita que a equipe estará esperando.
Exemplo de tom: "Olá [nome]! Lembrando que sua consulta é amanhã, [horário]. A equipe estará esperando por você 😊"`;
  }
}

export class ResponseComposer {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: OPENAI_TIMEOUT_MS,
      maxRetries: 0,
    });
  }

  async compose(input: ComposerInput): Promise<ComposedResponse> {
    const systemPrompt = buildSystemPrompt(input);
    const actionContext = buildActionContext(
      input.actionResult,
      input.conversationExperience ?? DEFAULT_CONVERSATION_EXPERIENCE,
      input.clinic.installmentTable,
    );

    // Histórico recente — filtra mensagens de sistema (marcadores internos como __appointment_confirmed__)
    // para evitar que o LLM use dados de agendamentos anteriores como referência de horários.
    // Manter em sincronia com IntentClassifier.ts (também usa 8).
    const recentHistory = input.conversationHistory
      .filter((m) => m.author !== "system" && !m.body.startsWith("__"))
      .slice(-8);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...recentHistory.map((m): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: m.author === "lead" ? "user" : "assistant",
        content: m.body,
      })),
      {
        role: "user",
        content: `[INSTRUÇÃO INTERNA — NÃO VISÍVEL AO LEAD]\nANTES DE REDIGIR: releia as mensagens anteriores. Se uma informação já foi mencionada (valor, parcelas, condições, endereço), OMITA-a — a menos que a mensagem atual do lead seja uma pergunta explícita sobre esse mesmo assunto. Se a ação/política/playbook trouxer valores, técnicas ou condições obrigatórias ainda não comunicadas sobre o assunto atual, inclua-os exatamente.\n\n${actionContext}\n\nEscreva a resposta agora:`,
      },
    ];

    const response = await this.client.chat.completions.create({
      model: MODEL,
      temperature: 0.5,
      max_tokens: 300,
      messages,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";

    // Extrai tag opcional [MEDIA:id] que o LLM insere ao final quando quer enviar mídia.
    const mediaMatch = raw.match(/\[MEDIA:([a-zA-Z0-9_-]+)\]/);
    const mediaId = mediaMatch?.[1] ?? null;
    const text = raw.replace(/\s*\[MEDIA:[a-zA-Z0-9_-]+\]/g, "").trim();

    return {
      text,
      mediaId,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  }
}
