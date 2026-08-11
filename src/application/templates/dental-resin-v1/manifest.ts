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
 * ## Por que o preço não aparece em texto nenhum daqui
 *
 * O valor estruturado tem dono canônico: `treatments`. Interpolar um número
 * numa resposta autorizada congelaria esse número dentro de
 * `playbook_versions.objections`, criando um segundo dono que envelhece
 * sozinho — e "escrever valor em prosa e esperar que a IA o respeite" é
 * precisamente como a assistente cotou um serviço 10x errado.
 *
 * A única exceção é `price.installmentsPolicy`, e ela é deliberada: condição
 * de pagamento é política comercial em prosa, cujo dono canônico já é o
 * playbook. Ela é bloqueante porque a política cadastrada dizia "12x"
 * enquanto o operador vendia 3x sem juros e até 21x com taxa.
 */

/**
 * Os quatro bloqueantes do gate de ativação, um placeholder cada.
 *
 * | Gate | Placeholder | Falha que o originou |
 * | --- | --- | --- |
 * | Canal e tenant | `clinic.displayName` | `clinic_not_resolved`: instância sem tenant resolvido |
 * | Preço | `price.installmentsPolicy` | condição inventada porque a cadastrada estava errada |
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
  // clinicamente melhor que a outra.
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
 * assistente de falar de cobertura sem ter o dado.
 *
 * A quinta é literalmente a pergunta que o operador humano escreveu ao
 * reescrever o opener da assistente: ele trocou o menu de três opções por uma
 * pergunta aberta.
 */
const QUALIFICATION_QUESTIONS: string[] = [
  "Você já é paciente da {{clinic.displayName}} ou é o seu primeiro contato com a gente?",
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
 */
const HANDOFF_REASONS: string[] = [
  "Lead relata dor, sangramento ou qualquer intercorrência depois de um procedimento",
  "Lead pede reparo ou ajuste de trabalho cuja origem não está confirmada",
  "Lead negocia desconto, permuta ou condição fora da política cadastrada: {{reception.teamLabel}} decide",
  "Lead já é paciente e pede retorno pós-procedimento: {{reception.teamLabel}} confere o protocolo antes de agendar",
  "Lead informa que já está na clínica esperando atendimento",
  "Lead pergunta o valor de um serviço que não está no catálogo da clínica",
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
