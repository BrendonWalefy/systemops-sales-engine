import { join } from "node:path";

/**
 * Inventário da camada de keyword — o instrumento do Ciclo D.
 *
 * ## Por que este arquivo existe
 *
 * Existem dois sistemas de intenção competindo. O `IntentClassifier` (17
 * intents, `json_schema` estrito, temperatura 0) e, dentro do orquestrador, uma
 * segunda camada feita de predicados de palavra-chave. A segunda cresceu sem
 * medição: cada bug de produção foi corrigido adicionando um `if`, porque um
 * `if` é barato de escrever e caro de testar exaustivamente.
 *
 * O Ciclo D **mede antes de remover**. Inverter essa ordem foi o que criou a
 * camada, e repetir a inversão para desfazê-la só trocaria um erro por outro.
 * Nenhum predicado é removido aqui.
 *
 * ## A régua de classificação
 *
 * Vem do plano canônico, e é uma pergunta só:
 *
 * - **feature** — o predicado lê **entrada estruturada**. Escolha por número,
 *   comando de reset, seleção de item de menu, rótulo exato. Isso é código, e
 *   deve continuar código: um classificador de linguagem não faria melhor.
 * - **cicatriz** — o predicado **reclassifica linguagem natural aberta**
 *   ("isto é uma pergunta de horário?", "isto é objeção de preço?"). É
 *   precisamente o trabalho do classificador, e é onde regex perde.
 *
 * A classificação não é opinião: cada entrada carrega `evidence`, e o teste
 * `KeywordPredicateRegistry.test.ts` recusa entrada sem evidência escrita e
 * recusa qualquer predicado marcado `readsOpenLanguage` classificado como
 * feature.
 *
 * ## Como o inventário se defende de derivar
 *
 * `predicatesDeclaredIn` varre os módulos e devolve todo predicado **booleano**
 * que decide sobre texto. O teste falha se algum deles não estiver aqui. Os
 * predicados que devolvem união ou objeto (`coerceBusinessIntent`,
 * `resolveMenuSelection`, …) não são alcançáveis por essa varredura e estão
 * registrados à mão — o teste "não registra predicado que não existe mais"
 * cobre o outro lado, impedindo que sobrevivam ao seu próprio código.
 */

export type PredicateClassification = "feature" | "scar";

export type PredicateModule = "orchestrator" | "response-parts";

export type KeywordPredicate = {
  /** Nome exato da função declarada. */
  name: string;
  module: PredicateModule;
  /**
   * Lê linguagem natural aberta para chegar ao veredito? `false` significa
   * entrada estruturada — número, comando, rótulo exato de menu.
   */
  readsOpenLanguage: boolean;
  /**
   * O intent que o predicado impõe ao disparar, no vocabulário da V1. `null`
   * quando ele decide um trilho que não é intent (bypass, throttle, formato).
   */
  impliedIntent: string | null;
  classification: PredicateClassification;
  /**
   * O que restringe o predicado em produção. Sem isto, o relatório confundiria
   * "poder discriminativo isolado" com "dano em produção": um predicado que só
   * roda num estado específico pode errar muito fora dele sem nunca ser
   * consultado ali.
   *
   * - `ungated` — roda sobre o texto de qualquer turno que chegue ao ramo.
   * - `intent-gated` — só é consultado depois de o classificador dizer algo.
   * - `state-gated` — só é consultado num estado de conversa específico.
   */
  runtimeGate: "ungated" | "intent-gated" | "state-gated";
  /** Por que essa classificação, com o fato que a sustenta. */
  evidence: string;
};

const ORCHESTRATOR = "src/core/pipeline/ConversationOrchestrator.ts";
const RESPONSE_PARTS = "src/core/conversation/conversation-response-parts.ts";

/**
 * Funções booleanas que a varredura encontra mas que **não** são camada de
 * intenção. Cada isenção diz por quê; sem motivo escrito, o predicado entra no
 * inventário.
 */
const ORCHESTRATOR_EXEMPT = [
  // Decidem sobre config, id ou estado — nunca sobre o texto do lead.
  "isValidMediaAssetId",
  "isAestheticTreatment",
  "isPipelinePhotoInstructionContentStep",
  "hasPipelineContentStepBeenSent",
  "shouldForceTextOnlyForActionResult",
  "shouldShowInitialMenu",
  "shouldOfferSlotsAfterPipelinePhoto",
  "shouldSendConciergeStarter",
  "shouldRestartConversation",
  "isRequestedTimeOutsideBusinessHours",
  "shouldDeferTreatmentPipelineEntry",
  "hasExplicitPipelineTreatmentTrigger",
  "shouldThrottleRapidLeadMessage",
  "shouldSendShortReviewAck",
  "canAppendQaFollowUpContent",
  "shouldSuppressNextStepCta",
  "isGenericTreatmentInterestMessage",
  "hasAgentRequestedPhoto",
  "isAffirmativeReplyToOpenOffer",
  "lastSlotOfferWasByOperator",
  "isRepeatedConversationalReply",
  "requiresTeamCheckForHours",
  "shouldResumeManualTakeoverForScheduling",
  "isLikelyBusinessMessage",
  "shouldBypassPendingPipelineContent",
  "matchMediaOnKeywords",
  "hasAnyKeyword",
] as const;

const RESPONSE_PARTS_EXEMPT = [
  "isValidMediaAssetId",
  "isAestheticTreatment",
  "isPipelinePhotoInstructionContentStep",
  "hasPipelineContentStepBeenSent",
  "shouldSuppressNextStepCta",
  "isAffirmativeReplyToOpenOffer",
  "hasAgentRequestedPhoto",
  "isGenericTreatmentInterestMessage",
  "hasAnyKeyword",
] as const;

export const KEYWORD_PREDICATE_SOURCES: ReadonlyArray<{
  module: PredicateModule;
  path: string;
  exempt: readonly string[];
}> = [
  {
    module: "orchestrator",
    path: join(process.cwd(), ORCHESTRATOR),
    exempt: ORCHESTRATOR_EXEMPT,
  },
  {
    module: "response-parts",
    path: join(process.cwd(), RESPONSE_PARTS),
    exempt: RESPONSE_PARTS_EXEMPT,
  },
];

/**
 * Devolve os predicados booleanos sobre texto declarados num módulo.
 *
 * Deliberadamente conservador: exige tipo de retorno `boolean` declarado **e**
 * uma operação de casamento de texto no corpo. Falso negativo aqui é coberto
 * pelo registro manual; falso positivo obrigaria a inventar isenção, que é pior.
 */
export function predicatesDeclaredIn(source: string): string[] {
  const lines = source.split("\n");
  const found: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const declaration = /^(?:export )?function ([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(
      lines[i],
    );
    if (!declaration) continue;

    let depth = 0;
    let started = false;
    let end = i;
    for (let j = i; j < lines.length; j++) {
      for (const character of lines[j]) {
        if (character === "{") {
          depth++;
          started = true;
        } else if (character === "}") depth--;
      }
      if (started && depth === 0) {
        end = j;
        break;
      }
    }

    const body = lines.slice(i, end + 1).join("\n");
    const returnsBoolean = /\)\s*:\s*boolean\s*\{/.test(body);
    const matchesText =
      /hasAnyKeyword\(|normalizeFreeText\(|\.includes\(|\.startsWith\(|\.test\(/.test(
        body,
      );
    const readsText =
      /\b(message|normalized|body|text|lastAgentMessage|candidate|raw)\b/.test(body);

    if (returnsBoolean && matchesText && readsText) found.push(declaration[1]);
  }

  return found;
}

/**
 * O inventário.
 *
 * A auditoria estimou "30 predicados". Aplicada a régua acima de forma
 * explícita, a camada tem mais do que isso — e o número maior é, por si, um
 * achado do ciclo: a estimativa de 30 nasceu de uma amostra de exemplos, não de
 * uma varredura.
 */
export const KEYWORD_PREDICATE_REGISTRY: readonly KeywordPredicate[] = [
  // ── Entrada estruturada — feature ───────────────────────────────────────
  {
    name: "isResetCommand",
    module: "orchestrator",
    readsOpenLanguage: false,
    impliedIntent: null,
    classification: "feature",
    runtimeGate: "ungated",
    evidence:
      "Compara a mensagem inteira contra quatro literais exatos (/reset, reset, resetar, /resetar). Não há linguagem aberta: ou o texto é o comando, ou não é. Um classificador aqui só adicionaria latência e incerteza a uma decisão que já é exata.",
  },
  {
    name: "resolveMenuSelection",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: null,
    classification: "scar",
    runtimeGate: "state-gated",
    evidence:
      "Híbrido, e é o híbrido que o condena. As duas primeiras rotas são feature legítima: número digitado e rótulo exato do item ativo, ambos comparados por igualdade. A partir daí vira reclassificação aberta — sete blocos de `includes` mapeando 'procedimento'/'agendar'/'valor'/'especialista' para intents. O próprio código documenta duas cicatrizes dentro de si: 'remarcar'/'desmarcar' precisaram de guarda porque contêm 'marcar' como substring, e 'consulta' foi removida da lista por ser ambígua entre urgência, cancelamento e remarcação. O trecho estruturado deve sobreviver ao Ciclo J; o trecho de keyword é o alvo.",
  },
  {
    name: "isMenuRerequest",
    module: "orchestrator",
    readsOpenLanguage: false,
    impliedIntent: null,
    classification: "feature",
    runtimeGate: "ungated",
    evidence:
      "Detecta pedido de volta ao menu por 14 formas fixas ('menu', 'voltar', 'voltar ao menu', …). É navegação de interface, não conteúdo de negócio: o lead está operando um menu numerado que o próprio sistema ofereceu, e o vocabulário é fechado por construção.",
  },
  {
    name: "messageOffersConcreteSlot",
    module: "orchestrator",
    readsOpenLanguage: false,
    impliedIntent: null,
    classification: "feature",
    runtimeGate: "state-gated",
    evidence:
      "Lê texto do OPERADOR/agente, não do lead, e procura um padrão estruturado — hora concreta (\\d{1,2}[:h]\\d{2}) num contexto de oferta. É extração de dado já emitido pelo próprio sistema; não há intenção de lead a interpretar.",
  },

  // ── Reclassificação de linguagem aberta — cicatriz ──────────────────────
  {
    name: "coerceBusinessIntent",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: null,
    classification: "scar",
    runtimeGate: "intent-gated",
    evidence:
      "A cicatriz-mãe: sua finalidade declarada em comentário é sobrescrever o classificador ('se a mensagem contém conteúdo de negócio detectável, o intent conversacional é sobrescrito'). Encadeia oito predicados em ordem de prioridade fixa, cada um adicionado por um bug específico (P0.1, P0.2, P0.5 estão anotados no código). É o ponto onde a camada de keyword vence a camada de LLM por construção.",
  },
  {
    name: "isBusinessHoursQuestion",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "general_question",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "62 linhas para responder 'isto é pergunta de expediente?'. Carrega cinco remendos de bugs reais documentados em comentário: saudação removida porque 'bom dia' fazia 'dia' casar como período; 'como funciona' desqualificado porque perguntava processo e devolvia horário; 'funciona' exigindo sujeito de negócio porque a operação do próprio lead virava tabela de horário (13/08); data explícita excluída porque 'dia 8/8 se tiver horário' caía em funcionamento (caso Tatiana 19/07); e uma denylist de agendamento no final. Cada remendo é a assinatura de um classificador implementado em regex.",
  },
  {
    name: "isPriceRequestText",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "price_inquiry",
    classification: "scar",
    runtimeGate: "intent-gated",
    evidence:
      "Sete palavras soltas ('valor', 'preco', 'quanto', 'custa', 'custo', 'pagamento', 'parcela') casadas por substring, sem nenhum contexto. 'quanto tempo dura' e 'quanto de dor' disparam preço; o corpus tem `procedure-duration` e `treatment-timeline` como requests distintos que esta lista não sabe separar. É o caso puro de reclassificar linguagem aberta que o classificador já resolve com contexto.",
  },
  {
    name: "isSchedulingRequestText",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "book_appointment",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Nove palavras por substring, incluindo 'remarcar' e 'cancelar' — que o próprio `resolveMenuSelection` precisou excluir explicitamente do caminho de menu por serem intents opostos. Aqui elas resolvem para `book_appointment`, colidindo com os requests `postpone` e `confirm-appointment` do corpus. A colisão está no código, não na hipótese.",
  },
  {
    name: "isLocationRequestText",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "general_question",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Regex de seis termos incluindo 'onde', 'aonde', 'fica' soltos. O próprio código admite o problema ao criar `isDirectAddressQuestion` como versão estrita, com o comentário: durante a pausa de revisão, 'onde está minha avaliação?' disparava o endereço. Dois predicados para a mesma pergunta, com precisões diferentes, é a definição de cicatriz.",
  },
  {
    name: "isDirectAddressQuestion",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "general_question",
    classification: "scar",
    runtimeGate: "state-gated",
    evidence:
      "Existe apenas porque `isLocationRequestText` é impreciso demais para o contexto de pausa clínica — o comentário no código diz isso literalmente. Um segundo predicado calibrado para o mesmo eixo semântico é a cicatriz do primeiro, não uma feature nova.",
  },
  {
    name: "isLocationRequest",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "general_question",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Wrapper de uma linha sobre `isLocationRequestText`, herdando integralmente a imprecisão dele. Terceira porta de entrada para o mesmo eixo (localização), agora do lado do texto cru.",
  },
  {
    name: "isProcedureCatalogRequest",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "general_question",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Três regexes compostas tentando separar 'quais procedimentos vocês fazem' (catálogo) de 'o procedimento dói' (singular definido) — uma distinção de determinante e número gramatical, exatamente o tipo de julgamento linguístico que o classificador faz com contexto e o regex faz por enumeração.",
  },
  {
    name: "isProcedureCatalogRequestText",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "general_question",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Quatro palavras por substring, sem a guarda de singular definido que a versão irmã `isProcedureCatalogRequest` implementa. Duas versões do mesmo eixo com precisões divergentes convivendo no mesmo arquivo: quem chama qual é acidente histórico, não desenho.",
  },
  {
    name: "isUrgencyRequestText",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "clinical_urgency",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Cinco palavras ('dor', 'urgencia', 'sangramento', 'emergencia', 'urgente') por substring. 'dor' casa dentro de 'dormir' e 'adorei' — e urgência clínica é o eixo de maior custo de erro do produto. O corpus separa `clinical-suitability` de `clinical-advice`; esta lista não distingue nenhum dos dois.",
  },
  {
    name: "isHumanRequestText",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "needs_human",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Dez palavras que misturam dois eixos incompatíveis: pedido de pessoa ('atendente', 'humano', 'ligar') e pedido comercial ('desconto', 'especial'). O corpus trata `reach-person` e `discount-request` como requests distintos. Colapsá-los num predicado é perder a distinção antes de qualquer decisão.",
  },
  {
    name: "isPeriodPreferenceText",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: null,
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Quatro palavras ('manha', 'tarde', 'noite', 'cedo') por substring — precisamente as que `isBusinessHoursQuestion` teve de remover da saudação, porque 'boa tarde' as dispara. O mesmo falso positivo que já custou um remendo documentado continua aberto aqui.",
  },
  {
    name: "isSimplePaymentPolicyQuestion",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "price_inquiry",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Oito palavras de forma de pagamento menos doze de negociação — um classificador de duas classes implementado como diferença de listas. A lista negativa ('desconto', 'permuta', 'excecao', 'combinado', …) existe só porque a positiva sozinha errava; é o remendo visível dentro do predicado.",
  },
  {
    name: "isWarrantyQuestion",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "needs_human",
    classification: "scar",
    runtimeGate: "intent-gated",
    evidence:
      "Três regexes com janela de 40 caracteres entre termos. O comentário no código registra duas correções de bug: chaves acentuadas nunca casavam contra texto normalizado ('ainda está coberto', 'é grátis'), e 'cobre' solto casava 'cobrei' e 'descobre'. Decide um trilho que responde pela config em qualquer intent — precisão alta exigida, regex entregando aproximação.",
  },
  {
    name: "isMaintenanceInquiryText",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "needs_human",
    classification: "scar",
    runtimeGate: "intent-gated",
    evidence:
      "Substring sobre uma lista de palavras de manutenção. Roda dentro de `coerceBusinessIntent` logo após garantia, e o comentário P0.2 admite que a ordem entre os dois foi escolhida à mão porque ambos redirecionam para needs_human com contexto diferente — prioridade resolvida por posição no arquivo.",
  },
  {
    name: "isClinicNameOrAddressChangeQuestion",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "general_question",
    classification: "scar",
    runtimeGate: "intent-gated",
    evidence:
      "Nasceu de cinco conversas idênticas em produção (Julie, Thiago, Jeny, Jose Mota) e carrega dois bugs corrigidos em comentário: 'endereço' com cedilha comparado contra texto sem acento nunca casava, e a lista de mudança não tinha 'trocaram' (caso Rafaela). Combina extração de política com casamento de substring — a menção ao nome antigo vem da config, mas a decisão é keyword.",
  },
  {
    name: "detectUncataloguedMaintenanceInquiry",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "needs_human",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Tokeniza a mensagem e cruza com a mesma lista de manutenção, escapando quando o catálogo do tenant cobre o termo. A parte que consulta o catálogo é legítima; a que decide 'isto é pergunta de manutenção' pela presença de um token é a reclassificação aberta.",
  },
  {
    name: "isQuantityFollowupToPriceQuestion",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "price_inquiry",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Reconstrói o assunto da conversa lendo a mensagem anterior do lead com `isPriceRequestText`. O comentário traz a medição que o justificou: 3 de 6 continuações de quantidade caíam fora de price_inquiry. O problema medido é real — a memória de assunto entre turnos — mas a solução é keyword sobre keyword, e herda a imprecisão de `isPriceRequestText`.",
  },
  {
    name: "isSaturdayQuestionForOperatingClinic",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "general_question",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Um dia da semana com predicado próprio. Regex /\\bsabados?\\b/ cruzada com a escala configurada. É a marca registrada da camada: o bug 'Segunda' → falso indisponível está na memória do projeto, e a resposta foi criar o predicado do sábado em vez de corrigir o eixo de disponibilidade.",
  },
  {
    name: "detectPatientArrivalText",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "patient_arrived",
    classification: "scar",
    runtimeGate: "intent-gated",
    evidence:
      "Lista de frases fixas de chegada casadas por substring. Nasceu de um caso de áudio real ('estou aqui na frente e ninguém atende' → acknowledgment) citado no comentário de `coerceBusinessIntent`. O sinal é legítimo e importante; a implementação é enumeração de paráfrases, que é o que o classificador generaliza.",
  },
  {
    name: "isSocialProfileRequest",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "general_question",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Seis termos incluindo o erro de digitação 'instagran' — enumerar grafias erradas à mão é exatamente o trabalho que um classificador não precisa que se faça.",
  },
  {
    name: "isMediaClarificationRequest",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "general_question",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Exige a conjunção de duas listas, uma delas com pronomes demonstrativos soltos ('dessa', 'desse', 'essa', 'esse') e a outra com termos de técnica do tenant ('premium', 'estratificada'). Resolução de referência anafórica — a que o 'essa' se refere — resolvida por co-ocorrência de palavras.",
  },
  {
    name: "isIsolatedGreeting",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "greeting",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "16 padrões comparados por igualdade com três sufixos de pontuação cada. É igualdade exata, mas sobre linguagem aberta: qualquer saudação fora da lista ('opa', 'boa noiteee', 'oii') falha, e o classificador já tem `greeting` entre os 17 intents.",
  },
  {
    name: "detectAppointmentConfirmation",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "confirm_slot",
    classification: "scar",
    runtimeGate: "state-gated",
    evidence:
      "Três listas somando 60+ tokens para decidir entre sim/não/remarcar/ambíguo na resposta ao lembrete. Inclui variantes com e sem acento da mesma palavra ('nao' e 'não' repetidos), o que revela que a normalização não está garantida no caminho — e a decisão erra em favor de cancelar quando erra.",
  },
  {
    name: "didAgentAskForProcedure",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: null,
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Lê o texto que a própria IA gerou e tenta descobrir, por quatro substrings, se ela perguntou algo. O sistema está adivinhando o que ele mesmo acabou de fazer — o estado deveria ser registrado na decisão, não reconstruído do texto. É a cicatriz que o `NextStep`/`repeatPolicy` do Ciclo E existe para eliminar.",
  },
  {
    name: "didAgentAskToShowAvailability",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "check_availability",
    classification: "scar",
    runtimeGate: "state-gated",
    evidence:
      "Mesmo antipadrão do anterior, com duas listas conjugadas (menção a agenda × pedido de permissão) sobre a saída da própria IA. Sete formas de 'posso te mostrar' enumeradas à mão porque o composer é livre para reescrever a frase — o predicado persegue a prosa que o próprio sistema gera.",
  },
  {
    name: "normalizeSchedulingIntentForMissingPendingOffer",
    module: "orchestrator",
    readsOpenLanguage: true,
    impliedIntent: "check_availability",
    classification: "scar",
    runtimeGate: "state-gated",
    evidence:
      "Sobrescreve `confirm_slot` para `check_availability` quando não há oferta pendente, combinando `isShortAffirmativeReply`, `didAgentAskToShowAvailability` e `isSchedulingRequestText`. É correção de estado feita por leitura de texto: a ausência de oferta pendente já é um fato estrutural conhecido, e a decisão não precisaria consultar palavra nenhuma.",
  },
  {
    name: "isShortAffirmativeReply",
    module: "response-parts",
    readsOpenLanguage: true,
    impliedIntent: null,
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Lista de aceites curtos por igualdade/prefixo. Alimenta a normalização de agendamento acima, e um falso positivo ali troca confirmação por consulta de disponibilidade. 'Sim' isolado é ambíguo sem o turno anterior — que é contexto, não palavra.",
  },
  {
    name: "isRemotePreEvaluationRequest",
    module: "response-parts",
    readsOpenLanguage: true,
    impliedIntent: "general_question",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Detecta pedido de pré-avaliação a distância por palavras-chave. A memória do projeto registra `media-0002` como caso em que 'realizamos uma pré-avaliação' foi afirmado sem side effect — o eixo é sensível a promessa não cumprida, e keyword não distingue pedir de já ter recebido.",
  },
  {
    name: "isShowcaseRequestText",
    module: "response-parts",
    readsOpenLanguage: true,
    impliedIntent: "general_question",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Decide 'o lead quer ver casos/antes-e-depois' por palavras. Governa envio de mídia, e o corpus tem `see-media` e `send-media` como requests distintos — a lista não separa quem quer ver de quem está mandando foto.",
  },
  {
    name: "isEvaluationPriceRequest",
    module: "response-parts",
    readsOpenLanguage: true,
    impliedIntent: "price_inquiry",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Separa 'quanto custa a avaliação' de 'quanto custa o tratamento' por palavras-chave. O corpus tem `evaluation-cost` e `price-of-service` como requests distintos justamente porque a confusão é frequente; a memória do projeto registra a ambiguidade de preço R$4.000 × R$2.000 como pendente.",
  },
  {
    name: "agentMessageEndsWithCta",
    module: "response-parts",
    readsOpenLanguage: true,
    impliedIntent: null,
    classification: "scar",
    runtimeGate: "state-gated",
    evidence:
      "Descoberto pela varredura deste inventário, não pela auditoria — a estimativa de 30 não o continha. Procura, por substring, se a própria IA terminou com um CTA, para decidir se pode repetir. Mesmo antipadrão de `didAgentAskForProcedure`: o sistema relê o texto que gerou porque não registrou a decisão que o gerou.",
  },
  {
    name: "leadEngagesWithCta",
    module: "response-parts",
    readsOpenLanguage: true,
    impliedIntent: null,
    classification: "scar",
    runtimeGate: "state-gated",
    evidence:
      "Descoberto pela varredura, ausente da estimativa de 30. Decide se o lead aceitou o CTA por 16 palavras isoladas mais 6 frases. A lista inclui 'sim', 'pode', 'claro' e 'quando' soltos — 'quando vocês fecham?' conta como engajamento com o CTA. Governa supressão de CTA repetido, e o bug de CTA repetido já é caso de regressão no corpus (regression:cta-repetido).",
  },
  {
    name: "isClinicalTreatmentPlanJudgmentRequest",
    module: "response-parts",
    readsOpenLanguage: true,
    impliedIntent: "needs_human",
    classification: "scar",
    runtimeGate: "ungated",
    evidence:
      "Decide, por palavras-chave, se o lead está pedindo julgamento clínico sobre um plano de tratamento — o eixo de maior risco do produto, onde errar significa a IA opinando sobre conduta clínica. O corpus separa `clinical-suitability` de `clinical-advice`; a lista não alcança a distinção.",
  },
];
