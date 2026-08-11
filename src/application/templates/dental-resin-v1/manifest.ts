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
 * ## Preço: o que é placeholder e o que é dono canônico
 *
 * Um rascunho anterior deste arquivo não deixava nenhum valor entrar no texto
 * autorizado, com o argumento de que isso criaria um segundo dono do preço. O
 * argumento estava errado, e `price.installmentsPolicy` já era a prova: um
 * placeholder renderizado na instalação não é um dono paralelo, é o mesmo
 * valor que a clínica forneceu, escrito também onde o lead vai ler.
 *
 * O que continua valendo é mais estreito: o template nunca traz número
 * próprio. Todo valor vem da clínica, por placeholder bloqueante. Quando a
 * clínica alterar o preço depois da instalação, o texto instalado não
 * acompanha sozinho — ver a nota de risco no relatório desta task.
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
 * | Preço | `price.startingFrom`, `price.installmentsPolicy` | preço 10x errado; política dizia "12x", operador vendia 3x |
 * | Agenda | `agenda.evaluationLabel` | horário oferecido sem vir da agenda |
 * | Mídia e recepção | `media.priceCard` | preço vive numa arte; sem o asset, o valor nunca sai |
 *
 * Todo o resto é `defaulted` e chega com valor pronto. Não existe terceira
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

  // Nomes comerciais: chegam com uma descrição neutra da técnica, que a
  // clínica troca pelo vocabulário dela. Descrever a técnica não é afirmar
  // resultado, e nenhum dos dois defaults sugere que uma camada seja
  // clinicamente melhor.
  {
    key: "variant.base.name",
    kind: "defaulted",
    label: "Nome comercial da variante base",
    defaultValue: "resina em camada única",
  },
  {
    key: "variant.enhanced.name",
    kind: "defaulted",
    label: "Nome comercial da variante enhanced",
    defaultValue: "resina em camadas",
  },
  // Frase única, nas palavras da clínica, com o que de fato separa as duas
  // opções. É `defaulted` porque nenhuma clínica pode ficar sem resposta aqui,
  // e o default é deliberadamente factual e curto: qualquer coisa mais
  // específica seria o template afirmando técnica em nome de uma clínica que
  // ele não conhece.
  {
    key: "variant.differenceSummary",
    kind: "defaulted",
    label: "Uma frase com a diferença entre as duas opções, nas palavras da clínica",
    defaultValue: "A diferença está nas etapas de aplicação e no valor.",
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
