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
 * principal, fora do controle de versão. As citações abaixo trazem o caso
 * concreto junto da referência para que o raciocínio continue auditável sem o
 * documento em mãos.
 *
 * ## O campo `objection` é a FALA DO LEAD, não um rótulo
 *
 * Esta é a correção mais importante deste arquivo. Uma versão anterior escrevia
 * chaves como taxonomia para leitor humano — "Preço: o lead achou caro". O
 * runtime não as lê assim: `matchRegisteredObjection`
 * (`ConversationOrchestrator.ts`) casa a mensagem do lead contra o texto do
 * campo `objection`, por token distintivo. As regras dele, que ditam como
 * escrever aqui:
 *
 * - só conta token com **5 letras ou mais** ("caro", "dói", "dura" não contam);
 * - token que aparece em **duas ou mais** chaves é descartado (por isso cinco
 *   chaves começando com "Preço:" anulavam justamente "preco");
 * - `preco`, `valor`, `dente`, `horario`, `clinica`, `dentista` e os nomes de
 *   tratamento da clínica são descartados como genéricos do nicho;
 * - a comparação é sobre texto normalizado e singularizado.
 *
 * Portanto cada chave abaixo é escrita como o lead escreveria, com alternativas
 * separadas por barra para ampliar a superfície de casamento, e os tokens
 * distintivos de cada uma são escolhidos para não colidir com os das outras. A
 * taxonomia legível ficou nos comentários, que é onde ela serve.
 *
 * `src/__tests__/DentalResinObjectionMatching.test.ts` roda o matcher real
 * contra estas chaves. Ele é a prova; a intuição aqui não vale nada.
 *
 * ## As quatro regras, e a falha real atrás de cada uma
 *
 * 1. **Responder antes de vender.** F1 da auditoria: a saudação-concierge era
 *    enviada mesmo quando o lead já tinha dito o que queria. Três dos cinco
 *    casos listados em F1 eram pedidos de valor (Tania, Julllys, Jean); os
 *    outros dois eram uma paciente na porta da clínica e uma dúvida clínica em
 *    áudio — mesma falha, gatilhos diferentes.
 * 2. **Uma ideia por turno, no máximo um pedido de informação.** O operador
 *    humano vive na faixa de 41–120 caracteres: 30% das mensagens dele contra
 *    4% das da assistente.
 * 3. **Nenhum valor, condição, quantidade ou prazo que não venha da
 *    configuração da clínica.** F3/F5: a assistente ancorou uma lead num preço
 *    10x maior que o real, e a política cadastrada dizia "12x" enquanto o
 *    operador vendia 3x sem juros.
 * 4. **Nunca encerrar passivamente.** O operador nunca fecha com "é só me
 *    chamar": ou pergunta, ou oferta o próximo passo concreto. E nunca duas
 *    respostas seguidas fecham com a mesma frase — mensagem idêntica repetida
 *    já é defeito de produção neste projeto.
 *
 * ## Por que nenhuma resposta diz um valor
 *
 * O preço de partida chegou a entrar aqui como `{{price.startingFrom}}`. Está
 * fora de novo, e a razão não é estilo: renderizar o número no texto o grava em
 * `playbook_versions.objections`, uma tabela com caminho de edição próprio,
 * enquanto quem possui preço é `treatments` — e `price_campaigns` /
 * `resolveEffectivePrice` possuem o preço EFETIVO, consultados ao vivo. Texto
 * congelado contradiz toda campanha de desconto ativa. Ver o relatório da task.
 *
 * ## Dois silêncios deliberados
 *
 * Nenhuma afirmação de cobertura de garantia — sem origem confirmada a conduta
 * autorizada é perguntar. E nenhuma diferença entre `base` e `enhanced`
 * apresentada como superioridade clínica.
 *
 * ## Concordância
 *
 * O valor de um placeholder é texto livre da clínica, de gênero e número
 * desconhecidos: "na {{agenda.evaluationLabel}}" vira "na check-up inicial".
 * Por isso nenhum artigo encosta em placeholder, e nenhum pronome retoma um.
 */
export const DENTAL_RESIN_OBJECTIONS: AuthorizedObjection[] = [
  // Preço: o lead achou caro.
  // F6 (Tania): objeção de preço concreta ficou 17 dias no vácuo e o lead virou
  // `lost`. A saída não é defender o valor, é qualificar a quantidade.
  // Tokens distintivos: achei, orcamento, salgado.
  {
    objection: "Achei caro / está fora do meu orçamento / achei salgado",
    response:
      "Entendo. O valor muda conforme a quantidade de dentes, então dá para ajustar o plano. Quantos dentes você pensa em fazer?",
  },

  // Preço: o lead pede o valor logo no primeiro contato.
  // F1: "E qual seria os valores?" recebeu saudação genérica e o preço nunca
  // veio. A resposta não anuncia valor para depois não entregar, e também não
  // grava número nenhum — ver a nota sobre `price.startingFrom` no topo.
  // Tokens distintivos: custa, cobram, valores (singulariza para "valore", que
  // escapa do descarte de "valor"). "preço" está ali por ser a palavra que o
  // lead usa, mas não casa nada: o matcher descarta "preco" como genérico.
  {
    objection: "Quanto custa? / qual o preço? / quanto vocês cobram? / me passa os valores",
    response:
      "O valor depende de quantos dentes entram no plano. Quantos você pensa em tratar?",
  },

  // Preço: o lead compara com o orçamento de outra clínica.
  // F6 (Tania): "minha amiga pagou 1.800 nas 20". A assistente não pode
  // confirmar nem contestar orçamento alheio — pode descobrir o que havia nele.
  // Tokens distintivos: amiga, pagou, barato.
  {
    objection: "Minha amiga pagou menos / vi mais barato em outro lugar",
    response:
      "Faz sentido comparar. De um orçamento para outro mudam a quantidade de dentes e a técnica usada. Quantos dentes entravam nesse valor?",
  },

  // Preço: o lead pede desconto.
  // F6 (Studio Zed): proposta de permuta recebeu quatro respostas genéricas
  // "estou aqui se precisar". Desconto e permuta não são decisão da assistente,
  // e a resposta não retoma o placeholder com pronome nenhum.
  // Tokens distintivos: desconto, promocao, abatimento.
  {
    objection: "Tem desconto? / vocês fazem promoção? / dá um abatimento?",
    response:
      "Desconto e condição fora da tabela quem decide é {{reception.teamLabel}}. Já estou passando sua conversa agora.",
  },

  // Preço: o lead pergunta por que o valor veio em imagem.
  // A variante `enhanced` entrega valor por arte (canal `media`). Uma
  // assistente que procura "R$" no texto não enxerga preço em imagem — foi
  // assim que o vídeo entrou em loop e o preço nunca saiu.
  // Tokens distintivos: escrito, imagem.
  {
    objection: "Por que veio em imagem? / manda escrito aqui no chat",
    response:
      "Os valores ficam na arte que eu te envio, com o que está incluso em cada opção. Quer que eu reenvie?",
    appliesToVariant: "enhanced",
  },

  // Parcelamento.
  // F5: o operador cota 3x sem juros e até 21x com taxa; a política cadastrada
  // dizia "12x". O texto exato é bloqueante. A resposta não afirma que dá para
  // dividir (a clínica pode praticar só à vista) e não oferece simular parcela:
  // simular exige um total que ninguém cotou.
  // Tokens distintivos: parcelar, cartao, dividir.
  {
    objection: "Dá pra parcelar? / aceita cartão? / consigo dividir?",
    response:
      "Sobre o pagamento: {{price.installmentsPolicy}}. Quer que eu veja um horário de {{agenda.evaluationLabel}}?",
  },

  // Durabilidade.
  // Nenhuma promessa de duração. Quem estima é o profissional, e citar a
  // avaliação não é oferecê-la.
  // Tokens distintivos: tempo, durabilidade.
  {
    objection: "Quanto tempo dura? / qual a durabilidade?",
    response:
      "Depende do seu hábito e da manutenção periódica — quem estima no seu caso é o dentista. Quer que eu veja um horário com ele?",
  },

  // Prazo do tratamento.
  // O lead perguntou tempo decorrido, não número de sessões. "tempo" ficou com
  // a durabilidade, então esta chave se apoia em prazo/demora/terminar.
  // Tokens distintivos: prazo, demora, pronto. "tempo" NÃO pode aparecer
  // aqui: ele é o token da durabilidade, e repetido nas duas chaves o matcher
  // o descarta por frequência — foi exatamente o que quebrou "quanto tempo
  // dura?" na primeira rodada deste arquivo.
  {
    objection: "Qual o prazo? / demora muito? / quando fica pronto?",
    response:
      "O tempo total depende de quantos dentes entram e do que o dentista encontrar. Prefere que eu já veja as datas de {{agenda.evaluationLabel}}?",
  },

  // Comparação entre as duas variantes.
  // A resposta que não pode virar ranking clínico. O conteúdo factual vem da
  // clínica por `variant.differenceSummary`, que é bloqueante: dizer que a
  // diferença entre duas técnicas é a técnica não ensina nada a ninguém.
  // Tokens distintivos: diferenca, opcoes.
  {
    objection: "Qual a diferença entre as duas opções? / o que muda de uma pra outra?",
    response:
      "São duas técnicas: {{variant.base.name}} e {{variant.enhanced.name}}. {{variant.differenceSummary}} Quer ver as duas em um horário de {{agenda.evaluationLabel}}?",
  },

  // Dor e desgaste.
  // Maior objeção não-financeira desta jornada, e as respostas fáceis
  // ("indolor", "sem dor", "sem desgaste") são proibidas com razão: são
  // afirmação clínica. Sem texto autorizado a LLM improvisa justamente aqui.
  // Tokens distintivos: sentir, desgastar, anestesia, machuca.
  {
    objection: "Dói? / vou sentir dor? / precisa desgastar o dente? / tem anestesia? / machuca?",
    response:
      "Entendo a preocupação. Só dá para responder isso examinando seus dentes. Quer que eu procure um horário para você?",
  },

  // O "não" macio.
  // Maior vazamento documentado: uma objeção de preço ficou 17 dias sem ninguém
  // acionado, e 774 leads de uma clínica pararam em `waiting_response`.
  // "Vou pensar" é objeção não dita — a resposta pede a objeção.
  // Tokens distintivos: pensar, chamo, conversar.
  {
    objection: "Vou pensar / depois eu te chamo / preciso conversar em casa",
    response:
      "Sem problema. Antes de você decidir, o que ainda pesa na sua escolha?",
  },

  // Reparo, origem não confirmada.
  // Sem origem confirmada não existe resposta sobre cobertura. A conduta
  // autorizada é perguntar, nunca afirmar.
  // Tokens distintivos: quebrou, soltou, lascou.
  {
    objection: "Minha lente quebrou / soltou / lascou, e agora?",
    response:
      "Sinto muito. Para te orientar certo, preciso saber onde esse trabalho foi feito — foi aqui com a gente?",
  },

  // Reparo, origem confirmada na clínica.
  // A outra metade da pergunta acima. Sem esta entrada, a única pergunta que o
  // template faz tinha uma resposta sem texto autorizado. Aqui a assistente não
  // decide nada — transfere com o contexto. É também a chave que o trilho de
  // garantia consulta, por isso carrega "garantia" e "cobertura": são as
  // palavras do LEAD, e a resposta continua sem afirmar cobertura nenhuma.
  // Tokens distintivos: descolou, garantia, cobertura, conserto.
  {
    objection: "Fiz com vocês e descolou / tem garantia? / cobertura de conserto",
    response:
      "Anotado. Vou passar sua conversa para {{reception.teamLabel}} agora, com o que você me contou.",
  },
];
