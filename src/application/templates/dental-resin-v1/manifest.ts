import type { TemplateManifest } from "@/application/templates/contract";
import { DENTAL_RESIN_OBJECTIONS } from "@/application/templates/dental-resin-v1/objections";

/**
 * Template instalável da jornada de resina — v1.
 *
 * Dados, sem lógica. O runtime NUNCA lê este arquivo: ele lê `organizations`,
 * `treatments` e `playbook_versions`, como sempre. O manifesto é artefato de
 * instalação; tratá-lo como segunda fonte de verdade é exatamente o problema
 * de dois donos que `docs/architecture/sources-of-truth.md` proíbe.
 *
 * ## Por que as variantes têm slug interno
 *
 * As duas clínicas reais usam palavras comerciais diferentes para as mesmas
 * duas camadas de técnica e preço. O pipeline, as objeções e os cenários de
 * replay precisam de uma referência estável; a clínica precisa do vocabulário
 * dela. O slug resolve os dois: `base` e `enhanced` são internos e nunca
 * aparecem para o lead, e o nome comercial entra por placeholder.
 *
 * `base` e `enhanced` não são "pior" e "melhor". São camadas de preço e
 * técnica. Nenhum texto deste template pode apresentar a diferença comercial
 * entre elas como superioridade clínica.
 *
 * ## Preço: por que nenhum valor é renderizado em texto autorizado
 *
 * Este arquivo já esteve nos dois extremos. Primeiro proibiu qualquer valor no
 * texto, com um argumento errado ("seria um segundo dono"). Depois passou a
 * renderizar `{{price.startingFrom}}` na resposta de preço. A segunda versão é
 * que estava errada, e por um motivo concreto:
 *
 * - renderizar o número o grava em `playbook_versions.objections`, uma tabela
 *   com caminho de edição próprio, enquanto quem possui preço é `treatments`.
 *   `sources-of-truth.md` item 5 chama isso de remodelagem obrigatória;
 * - pior que envelhecer: `price_campaigns` e `resolveEffectivePrice` possuem o
 *   preço EFETIVO e são consultados ao vivo pelo orquestrador. Texto congelado
 *   contradiz toda campanha de desconto ativa — o caminho que a clínica mais
 *   usa.
 *
 * Não existe hoje interpolação em tempo de composição para resolver isso: não
 * há nenhum `{{...}}` em `src/core` ou `src/application` fora desta pasta.
 * Dizer o preço de partida na conversa depende de uma mudança no caminho de
 * composição, que é de quem for dono do orquestrador — não desta task.
 *
 * `price.startingFrom` continua bloqueante, porque o valor precisa ser
 * capturado na instalação e escrito em `treatments`, onde ele mora. Ele é
 * referenciado apenas num motivo de handoff, que é texto interno de roteamento
 * e não fala com o lead.
 */

/**
 * Placeholders por área de gate de ativação.
 *
 * As quatro áreas — canal/tenant, preço, agenda, mídia e recepção — organizam
 * o que a clínica precisa fornecer. A tabela abaixo é orientação de autoria,
 * **não** o gate em si: quem decide ativação é `activation-gate.ts` (Task 7),
 * a partir do estado real da clínica, não desta lista.
 *
 * | Área | Placeholders bloqueantes | Falha que a originou |
 * | --- | --- | --- |
 * | Canal e tenant | `clinic.displayName` | `clinic_not_resolved`: instância sem tenant resolvido |
 * | Preço | `price.startingFrom`, `price.installmentsPolicy`, `variant.base.name`, `variant.enhanced.name`, `variant.differenceSummary` | preço 10x errado; política dizia "12x", operador vendia 3x |
 * | Agenda | `agenda.evaluationLabel` | horário oferecido sem vir da agenda |
 * | Mídia e recepção | `media.priceCard` | preço vive numa arte; sem o asset, o valor nunca sai |
 *
 * Os nomes comerciais das variantes são bloqueantes por correção de revisão:
 * um nome com valor padrão faz a assistente batizar o produto da clínica no
 * lugar dela, e o lead que veio de um anúncio com um nome ouve outro. Nome
 * comercial é fato que a clínica possui, da mesma classe do preço, e fornecê-lo
 * custa duas strings.
 *
 * Sobrou um único `defaulted`: `reception.teamLabel`. "Nossa equipe" é um
 * neutro razoável e não é nome de produto nem número — as duas classes de coisa
 * que o template não pode inventar no lugar da clínica. Não existe terceira
 * categoria: um campo que não bloqueia e chega vazio é o buraco por onde a
 * assistente inventa.
 */
const PLACEHOLDERS: TemplateManifest["placeholders"] = [
  {
    key: "clinic.displayName",
    kind: "blocking",
    label: "Nome da clínica como o lead a conhece",
  },
  {
    key: "price.startingFrom",
    kind: "blocking",
    label:
      "Valor de partida da jornada de resina, já formatado como a clínica o escreve",
  },
  {
    key: "price.installmentsPolicy",
    kind: "blocking",
    label:
      "Condição de pagamento que a assistente pode informar, no texto exato da clínica",
  },
  {
    key: "agenda.evaluationLabel",
    kind: "blocking",
    label: "Como a clínica chama a consulta que a assistente agenda",
  },
  {
    key: "media.priceCard",
    kind: "blocking",
    label: "Asset com a arte de valores da variante enhanced",
  },

  // Nomes comerciais: bloqueantes, sem valor padrão. É a palavra que o lead
  // viu no anúncio; o template não tem como adivinhá-la e não deve tentar.
  {
    key: "variant.base.name",
    kind: "blocking",
    label: "Nome comercial da variante base, como a clínica anuncia",
  },
  {
    key: "variant.enhanced.name",
    kind: "blocking",
    label: "Nome comercial da variante enhanced, como a clínica anuncia",
  },
  // Bloqueante, e não `defaulted`, por eliminação honesta: todo default que
  // tentamos escrever aqui era a tautologia "a diferença entre as duas
  // técnicas é a técnica", e qualquer default mais específico seria o template
  // afirmando técnica em nome de uma clínica que ele não conhece. Um campo que
  // só ensina algo quando alguém o reescreve não pode ter valor de partida.
  {
    key: "variant.differenceSummary",
    kind: "blocking",
    label:
      "Uma frase completa, terminada em ponto final, com a diferença entre as duas opções nas palavras da clínica — ela é interpolada no meio da resposta e o template não acrescenta pontuação",
  },
  {
    key: "reception.teamLabel",
    kind: "defaulted",
    label: "Como a assistente se refere à equipe humana ao transferir",
    defaultValue: "nossa equipe",
  },
];

/**
 * Perguntas de qualificação — curtas, uma ideia cada.
 *
 * A primeira existe por causa de E3 do mapa de comportamento: um paciente em
 * tratamento mandou áudio e foi tratado como lead novo, com a saudação de
 * abertura. Saber a origem antes de conduzir também é o que impede a
 * assistente de falar de cobertura sem ter o dado. Ela diz "paciente da casa"
 * em vez de interpolar o nome da clínica porque "da {{clinic.displayName}}"
 * erra a crase assim que o nome não é feminino.
 *
 * A segunda é literalmente a pergunta que o operador humano escreveu ao
 * reescrever o opener da assistente: ele trocou o menu de três opções por uma
 * pergunta aberta.
 */
const QUALIFICATION_QUESTIONS: string[] = [
  "Você já é paciente da casa ou é o seu primeiro contato com a gente?",
  "Você tem alguma dúvida sobre o procedimento?",
  "Quantos dentes você pensa em tratar?",
  "Você já fez algum procedimento nesses dentes antes?",
  "O que te fez procurar a gente agora?",
  "Quer que eu veja os horários de {{agenda.evaluationLabel}}?",
];

/**
 * Motivos de handoff. Cada um é uma falha registrada, não uma hipótese.
 *
 * Só uma conversa em 62 marcou `needs_attention` em toda a base auditada — a
 * assistente quase nunca aciona a equipe, inclusive em momento de venda.
 *
 * Os dois motivos de reparo são um par: a única pergunta que este template faz
 * ao lead tem duas respostas possíveis, e as duas precisam ter para onde ir.
 */
const HANDOFF_REASONS: string[] = [
  // Único lugar onde `price.startingFrom` aparece em texto. É roteamento
  // interno, lido pela equipe, não fala com o lead — o valor de partida não
  // pode virar prosa numa resposta, ver a nota de preço no topo do arquivo.
  "Lead insiste em fechar por valor abaixo de {{price.startingFrom}}: {{reception.teamLabel}} decide",
  "Lead relata dor, sangramento ou qualquer intercorrência depois de um procedimento",
  "Lead pede reparo ou ajuste de trabalho cuja origem não está confirmada",
  "Lead confirma que o trabalho a reparar foi feito aqui: {{reception.teamLabel}} verifica histórico e política antes de qualquer resposta sobre cobertura",
  "Lead negocia desconto, permuta ou condição fora da política cadastrada: {{reception.teamLabel}} decide",
  "Lead já é paciente e pede retorno pós-procedimento: {{reception.teamLabel}} confere o protocolo antes de agendar",
  "Lead informa que já está na clínica esperando atendimento",
  "Lead pede valor de um serviço que não está no catálogo de {{clinic.displayName}}",
  "Lead pede explicitamente para falar com uma pessoa",
];

export const dentalResinV1: TemplateManifest = {
  // `id` é estável entre versões; a pasta `dental-resin-v1` fixa a major, e
  // `version` é o que o registro de instalação compara para saber com qual
  // conteúdo a clínica foi instalada.
  id: "dental-resin",
  version: "1.0.0",
  segment: "odontologia-estetica",

  variants: [
    // Canal `text`: a assistente diz o valor na conversa. O operador humano
    // faz exatamente isso — informa o valor direto e emenda o próximo passo.
    {
      slug: "base",
      displayNamePlaceholder: "variant.base.name",
      priceChannel: "text",
      priceKind: "from",
    },
    // Canal `media`: o valor vive numa arte, a pedido da clínica. O asset é
    // exigido pelo contrato justamente porque sem ele o preço nunca sai.
    {
      slug: "enhanced",
      displayNamePlaceholder: "variant.enhanced.name",
      priceChannel: "media",
      priceKind: "from",
      mediaAssetPlaceholder: "media.priceCard",
    },
  ],

  placeholders: PLACEHOLDERS,
  objections: DENTAL_RESIN_OBJECTIONS,
  qualificationQuestions: QUALIFICATION_QUESTIONS,
  handoffReasons: HANDOFF_REASONS,
};
