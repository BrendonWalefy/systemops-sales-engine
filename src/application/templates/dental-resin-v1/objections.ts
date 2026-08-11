import type { TemplateManifest } from "@/application/templates/contract";

/** Uma resposta autorizada: o que a assistente pode dizer diante da objeção. */
export type AuthorizedObjection = TemplateManifest["objections"][number];

/**
 * Respostas autorizadas da jornada de resina.
 *
 * ## Procedência das fontes
 *
 * O conteúdo abaixo foi escrito a partir de três análises já sanitizadas —
 * nunca dos exports de mensagens, que contêm dado de paciente:
 *
 * - `docs/product/auditoria-conversacao-2026-07.md`
 * - `docs/product/mapa-comportamento-conversas-vitalli.md`
 * - `docs/product/objetividade-conversacional-diagnostico.md`
 *
 * **Esses três arquivos não estão versionados neste repositório.** Não existem
 * nem em `HEAD` nem em `origin/main`: vivem apenas na cópia de trabalho
 * principal do repositório, fora do controle de versão. Quem ler este arquivo
 * nesta branch não conseguirá abri-los. As citações abaixo trazem o caso
 * concreto junto da referência justamente para que o raciocínio continue
 * auditável sem o documento em mãos.
 *
 * ## As quatro regras, e a falha real atrás de cada uma
 *
 * 1. **Responder antes de vender.** F1 da auditoria: a saudação-concierge era
 *    enviada mesmo quando o lead já tinha dito o que queria. Três dos cinco
 *    casos listados em F1 eram pedidos de valor (Tania, Julllys, Jean); os
 *    outros dois eram uma paciente na porta da clínica e uma dúvida clínica em
 *    áudio — mesma falha, gatilhos diferentes. Toda resposta aqui começa pela
 *    resposta.
 * 2. **Uma ideia por turno, no máximo um pedido de informação.** O operador
 *    humano vive na faixa de 41–120 caracteres: 30% das mensagens dele contra
 *    4% das da assistente. O menu de três opções que a assistente usava foi
 *    reescrito pelo próprio operador como uma pergunta aberta.
 * 3. **Nenhum valor, condição, quantidade ou prazo que não venha da
 *    configuração da clínica.** F3/F5: a assistente ancorou uma lead num preço
 *    10x maior que o real, e a política cadastrada dizia "12x" enquanto o
 *    operador vendia 3x sem juros. Onde um valor é necessário, ele entra por
 *    placeholder bloqueante — a clínica preenche, o template nunca inventa.
 * 4. **Nunca encerrar passivamente.** O operador nunca fecha com "é só me
 *    chamar": ou pergunta, ou oferta o próximo passo concreto. Toda resposta
 *    termina em um dos dois.
 *
 * ## Dois silêncios deliberados
 *
 * Nenhuma afirmação de cobertura de garantia — a assistente já afirmou
 * cobertura sem ter o dado, e sem origem confirmada a conduta autorizada é
 * perguntar. E nenhuma diferença entre `base` e `enhanced` apresentada como
 * superioridade clínica: são camadas de preço e técnica que a clínica nomeia,
 * não dentes melhores e piores.
 *
 * ## Concordância: por que o texto evita artigos antes de placeholder
 *
 * O valor de um placeholder é texto livre da clínica, de gênero e número
 * desconhecidos. "na {{agenda.evaluationLabel}}" vira "na check-up inicial" e
 * "a {{variant.base.name}}" vira "a Kit Basic". Por isso o padrão aqui é
 * `de {{agenda.evaluationLabel}}` (precedido de "um horário"), nomes de
 * variante sem artigo, e nenhum pronome retomando `{{reception.teamLabel}}`.
 * A regra é estrutural: nada que dependa de como a clínica escreveu o valor.
 */
export const DENTAL_RESIN_OBJECTIONS: AuthorizedObjection[] = [
  // F6 (Tania): objeção de preço concreta ficou 17 dias no vácuo e o lead
  // virou `lost`. A saída não é defender o valor, é qualificar a quantidade —
  // a variável que realmente move o orçamento.
  {
    objection: "Preço: o lead achou caro",
    response:
      "Entendo. O valor muda conforme a quantidade de dentes, então dá para ajustar o plano. Quantos dentes você pensa em fazer?",
  },

  // F1: "E qual seria os valores?" recebeu saudação genérica e o preço nunca
  // veio. Uma versão anterior desta resposta anunciava o valor e entregava só
  // uma pergunta — o mesmo F1 em tom educado. As duas clínicas conhecidas
  // praticam divulgação imediata de preço, e ambas as variantes têm
  // `priceKind: "from"`, então existe um valor de partida a dizer. Ele entra
  // por `price.startingFrom`, que é bloqueante: sem ele a clínica não instala.
  {
    objection: "Preço: o lead pede o valor logo no primeiro contato",
    response:
      "As lentes em resina começam em {{price.startingFrom}} — o valor final depende de quantos dentes entram. Quantos você pensa em tratar?",
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
  // assistente. Sem pronome retomando o placeholder e sem jargão interno de
  // tabela: o lead não sabe o que é "condição fora da tabela" da clínica.
  {
    objection: "Preço: o lead pede desconto",
    response:
      "Desconto e condição fora da tabela quem decide é {{reception.teamLabel}}. Já estou passando sua conversa agora.",
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
  // dizia "12x". O texto exato é bloqueante — sem ele a assistente não
  // responde parcelamento. A resposta não afirma que dá para dividir (a
  // clínica pode praticar só à vista, e a frase se contradiria) e não oferece
  // simular parcela: simular exige um total que ninguém cotou, que é
  // exatamente a rampa para o número inventado que este template existe para
  // fechar.
  {
    objection: "Parcelamento: o lead quer dividir o pagamento",
    response:
      "Sobre o pagamento: {{price.installmentsPolicy}}. Quer que eu veja um horário de {{agenda.evaluationLabel}}?",
  },

  // Nenhuma promessa de duração. Quem estima é o profissional — e citar a
  // avaliação não é oferecê-la, então a resposta oferta o horário.
  {
    objection: "Durabilidade: quanto tempo o trabalho dura",
    response:
      "Depende do seu hábito e da manutenção periódica — quem estima no seu caso é o dentista. Quer que eu veja um horário de {{agenda.evaluationLabel}}?",
  },

  // O lead perguntou tempo decorrido, não número de sessões. Uma versão
  // anterior respondia sessões, que é outra pergunta.
  {
    objection: "Prazo: em quanto tempo o tratamento fica pronto",
    response:
      "O tempo total depende de quantos dentes entram e do que o dentista encontrar. Quer que eu veja um horário de {{agenda.evaluationLabel}}?",
  },

  // A resposta que não pode virar ranking clínico. O conteúdo factual da
  // diferença vem da clínica por `variant.differenceSummary`: dizer que a
  // diferença entre duas técnicas é a técnica não ensina nada a ninguém.
  {
    objection: "Comparação: qual a diferença entre as duas técnicas",
    response:
      "São duas técnicas: {{variant.base.name}} e {{variant.enhanced.name}}. {{variant.differenceSummary}} Quer ver as duas em um horário de {{agenda.evaluationLabel}}?",
  },

  // Dor e desgaste é a maior objeção não-financeira desta jornada, e as
  // respostas fáceis ("indolor", "sem dor", "sem desgaste") são proibidas com
  // razão: são afirmação clínica. Sem texto autorizado a LLM improvisa
  // justamente aqui. A conduta autorizada é reconhecer o medo, devolver a
  // resposta a quem pode dá-la e ofertar o próximo passo.
  {
    objection: "Dor e desgaste: dói ou precisa desgastar o dente",
    response:
      "Entendo a preocupação. Só dá para responder isso examinando seus dentes. Quer que eu veja um horário de {{agenda.evaluationLabel}}?",
  },

  // O "não" macio é o maior vazamento documentado: uma objeção de preço ficou
  // 17 dias sem ninguém acionado, e 774 leads de uma clínica pararam em
  // `waiting_response`. "Vou pensar" não é fim de conversa, é objeção não
  // dita — a resposta pede a objeção em vez de insistir na venda.
  {
    objection: "Adiamento: o lead diz que vai pensar ou some depois do valor",
    response:
      "Sem problema. Antes de você decidir, o que ainda pesa na sua escolha?",
  },

  // Sem origem confirmada não existe resposta sobre cobertura. A conduta
  // autorizada é perguntar, nunca afirmar.
  {
    objection: "Reparo: o trabalho quebrou, soltou ou lascou",
    response:
      "Sinto muito. Para te orientar certo, preciso saber onde esse trabalho foi feito — foi aqui com a gente?",
  },

  // A outra metade da pergunta acima. Sem esta entrada, a única pergunta que o
  // template faz tinha uma resposta sem texto autorizado: o lead responde
  // "sim, foi aí" e a assistente volta a improvisar sobre cobertura. Aqui ela
  // não decide nada — transfere com o contexto.
  {
    objection: "Reparo: o lead confirma que o trabalho foi feito na clínica",
    response:
      "Anotado. Vou passar sua conversa para {{reception.teamLabel}} agora, com o que você me contou.",
  },
];
