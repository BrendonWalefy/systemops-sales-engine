import type { TemplateManifest } from "@/application/templates/contract";

/** Uma resposta autorizada: o que a assistente pode dizer diante da objeção. */
export type AuthorizedObjection = TemplateManifest["objections"][number];

/**
 * Respostas autorizadas da jornada de resina.
 *
 * Escritas a partir das análises já sanitizadas — nunca dos exports de
 * mensagens, que contêm dado de paciente:
 *
 * - `docs/product/auditoria-conversacao-2026-07.md`
 * - `docs/product/mapa-comportamento-conversas-vitalli.md`
 * - `docs/product/objetividade-conversacional-diagnostico.md`
 *
 * Quatro regras governam cada texto abaixo, e cada uma tem uma falha real
 * atrás dela:
 *
 * 1. **Responder antes de vender.** F1 da auditoria: cinco leads pediram
 *    valor e receberam a saudação-concierge perguntando se queriam ver
 *    valores. Toda resposta aqui começa pela resposta.
 * 2. **Uma ideia por turno, no máximo uma pergunta.** O operador humano vive
 *    na faixa de 41–120 caracteres (30% das mensagens dele, 4% das da
 *    assistente). O menu de três opções que a assistente usava foi reescrito
 *    pelo próprio operador como uma pergunta aberta.
 * 3. **Nenhum valor, condição, quantidade ou prazo que não venha da
 *    configuração ativa.** F3/F5: a assistente ancorou uma lead num preço 10x
 *    maior que o real. Por isso nenhum texto abaixo carrega número: quando o
 *    valor é necessário, ele vem de `treatments` em runtime; quando a
 *    condição de pagamento é necessária, vem do placeholder bloqueante
 *    `price.installmentsPolicy`, preenchido pela clínica.
 * 4. **Nunca encerrar passivamente.** O operador nunca fecha com "é só me
 *    chamar": ou pergunta, ou oferta o próximo passo concreto. Toda resposta
 *    termina em um dos dois.
 *
 * E dois silêncios deliberados: nenhuma afirmação de cobertura de garantia
 * (a assistente já afirmou cobertura sem ter o dado — sem origem confirmada,
 * ela pergunta) e nenhuma diferença entre `base` e `enhanced` apresentada
 * como superioridade clínica. As duas são camadas de preço e técnica que a
 * clínica nomeia, não dentes melhores e piores.
 *
 * O nome comercial de cada variante entra só por `{{placeholder}}`: as duas
 * clínicas reais usam palavras diferentes para as mesmas duas camadas, e
 * congelar o vocabulário de uma delas no template quebra a outra.
 */
export const DENTAL_RESIN_OBJECTIONS: AuthorizedObjection[] = [
  // F6 (Tania): objeção de preço concreta ficou 17 dias no vácuo e o lead
  // virou `lost`. A saída não é defender o valor, é qualificar a quantidade —
  // que é a variável que realmente move o orçamento.
  {
    objection: "Preço: o lead achou caro",
    response:
      "Entendo. O valor muda conforme a quantidade de dentes, então dá para ajustar o plano. Quantos dentes você pensa em fazer?",
  },

  // F1: "E qual seria os valores?" recebeu saudação genérica e o preço nunca
  // veio. A resposta reconhece o pedido antes de qualificar.
  {
    objection: "Preço: o lead pede o valor logo no primeiro contato",
    response:
      "Claro, já te passo. Para eu acertar o valor, me diz quantos dentes você quer tratar?",
  },

  // F6 (Tania): "minha amiga pagou 1.800 nas 20". A assistente não pode
  // confirmar nem contestar orçamento alheio — pode descobrir o que estava
  // dentro dele.
  {
    objection: "Preço: o lead compara com o valor de outra clínica",
    response:
      "Faz sentido comparar. De um orçamento para outro mudam a quantidade de dentes e a técnica usada. Quantos dentes entravam nesse valor?",
  },

  // F6 (Studio Zed): proposta de permuta recebeu quatro respostas genéricas
  // "estou aqui se precisar". Desconto e permuta não são decisão da
  // assistente; a resposta transfere em vez de improvisar condição.
  {
    objection: "Preço: o lead pede desconto",
    response:
      "Condição diferente da tabela quem confirma é {{reception.teamLabel}}. Vou passar sua conversa para eles agora.",
  },

  // A variante `enhanced` entrega valor por arte (canal `media`). Uma
  // assistente que procura "R$" no texto não enxerga preço em imagem — foi
  // assim que o vídeo entrou em loop e o preço nunca saiu.
  {
    objection: "Preço: o lead pergunta por que o valor vem em imagem",
    response:
      "Os valores ficam na arte que eu te envio, com o que está incluso em cada opção. Quer que eu reenvie?",
    appliesToVariant: "enhanced",
  },

  // F5: o operador cota 3x sem juros e até 21x com taxa; a política cadastrada
  // dizia "12x". O texto exato da condição é bloqueante — sem ele a
  // assistente não responde parcelamento.
  {
    objection: "Parcelamento: o lead quer dividir o pagamento",
    response:
      "Dá para dividir sim: {{price.installmentsPolicy}}. Quer que eu veja como ficaria no seu caso?",
  },

  // Nenhuma promessa de duração. Quem estima é o profissional, na avaliação.
  {
    objection: "Durabilidade: quanto tempo o trabalho dura",
    response:
      "Depende do seu hábito e da manutenção periódica. Quem estima isso no seu caso é o dentista, na {{agenda.evaluationLabel}}.",
  },

  // Prazo também é estimativa clínica, e depende da quantidade — a mesma
  // variável do preço.
  {
    objection: "Prazo: em quanto tempo o tratamento fica pronto",
    response:
      "O número de sessões depende da quantidade de dentes. O dentista fecha esse plano com você na {{agenda.evaluationLabel}}.",
  },

  // A resposta que não pode virar ranking clínico: técnica e valor, e a
  // indicação fica com o profissional.
  {
    objection: "Comparação: qual a diferença entre as duas técnicas",
    response:
      "A diferença entre a {{variant.base.name}} e a {{variant.enhanced.name}} está na técnica de aplicação e no valor. Quer ver as duas na {{agenda.evaluationLabel}}?",
  },

  // Sem origem confirmada não existe resposta sobre cobertura. A conduta
  // autorizada é perguntar, nunca afirmar — a assistente já afirmou cobertura
  // sem ter o dado.
  {
    objection: "Reparo: o trabalho quebrou, soltou ou lascou",
    response:
      "Sinto muito. Para te orientar certo, preciso saber onde esse trabalho foi feito — foi aqui com a gente?",
  },
];
