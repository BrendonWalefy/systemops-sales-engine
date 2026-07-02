/**
 * Roteiros curados da clínica demo "Odonto Marques".
 *
 * A demo prioriza 10 conversas completas em vez de muitas threads rasas.
 * Cada caso tem saudação, oferta, explicação, objeção, convite para avaliação
 * e confirmação de agendamento.
 */
import type { DemoTurn } from "./generate-demo-conversation";

export type DemoConvStatus =
  | "in_conversation"
  | "waiting_response"
  | "appointment_scheduled"
  | "follow_up_due"
  | "won"
  | "lost";

export type DemoChannel = "whatsapp" | "instagram" | "meta_ads" | "referral";

export type DemoConversationSpec = {
  key: string;
  leadName: string;
  treatment: string;
  channel: DemoChannel;
  status: DemoConvStatus;
  temperature: "hot" | "warm" | "cold" | null;
  booked: boolean;
  needsAttention?: boolean;
  attentionReason?: string;
  aiPaused?: boolean;
  afterHours?: boolean;
  voiceStyle?: "bwave" | "simple";
  daysAgo: number;
  turns: DemoTurn[];
};

function conv(
  key: string,
  leadName: string,
  treatment: string,
  channel: DemoChannel,
  daysAgo: number,
  turns: DemoTurn[],
): DemoConversationSpec {
  return { key, leadName, treatment, channel, status: "appointment_scheduled", temperature: "hot", booked: true, daysAgo, turns };
}

export const DEMO_CONVERSATIONS: DemoConversationSpec[] = [
  conv("lentes-resina-noiva", "Camila Rocha", "Lentes de resina", "instagram", 0, [
    { lead: "Oi, boa tarde! Vi o perfil de vocês e queria melhorar meu sorriso pro meu casamento. Vocês fazem lentes?", agent: "Boa tarde, Camila! Sou a Marina, da Odonto Marques. Fazemos lentes em resina e lentes de porcelana. Para casamento, primeiro entendemos prazo, cor desejada e quantos dentes aparecem no sorriso. Posso te explicar as opções?" },
    { lead: "Pode sim. Quero algo bonito, mas tenho medo de ficar artificial.", agent: "Perfeito. As lentes em resina melhoram formato, pequenas assimetrias e cor com resultado natural quando o planejamento respeita seu rosto. A porcelana costuma ter mais estabilidade de cor e durabilidade. Em ambos os casos, o objetivo é um sorriso harmônico para você." },
    { lead: "Lente em resina estraga meus dentes?", agent: "A indicação correta é o que protege seu dente. Na avaliação, a dentista analisa mordida, esmalte, gengiva e espaço disponível. Muitas vezes conseguimos ser conservadores, mas não prometemos sem examinar porque cada caso muda bastante." },
    { lead: "Meu casamento é daqui dois meses. Dá tempo?", agent: "Dois meses é um bom prazo para planejar sem correria. Se estiver tudo saudável, conseguimos avançar. Se precisar de limpeza, gengiva ou clareamento antes, também dá para organizar a sequência certa." },
    { lead: "Quanto custa mais ou menos?", agent: "A avaliação estética custa R$ 150. O valor das lentes depende da técnica, quantidade de dentes e planejamento, então fechamos o orçamento com segurança depois da análise. Parcelamos no cartão e a dentista costuma montar opções por prioridade." },
    { lead: "Queria ver se ficaria bom em mim antes de fechar.", agent: "Faz todo sentido. Na avaliação a dentista conversa sobre expectativa, analisa seu sorriso e mostra se resina atende bem ou se porcelana faz mais sentido para o resultado que você quer." },
    { lead: "Então quero marcar essa avaliação.", agent: "Perfeito. Tenho terça às 10h30, quarta às 15h ou sexta às 11h para avaliação estética. Qual fica melhor para você?" },
    { lead: "Quarta às 15h fica ótimo.", agent: "Agendado, Camila! Sua avaliação ficou para quarta às 15h na Odonto Marques. Te esperamos para planejar seu sorriso com calma e deixar tudo alinhado para o casamento." },
  ]),
  conv("lentes-resina-restauracoes", "Diego Furtado", "Lentes de resina", "meta_ads", 1, [
    { lead: "Oi. Tenho restaurações antigas nos dentes da frente e queria saber se lentes resolvem.", agent: "Oi, Diego! Sou a Marina, da Odonto Marques. Lentes em resina podem ajudar em restaurações antigas, manchas e alteração de formato. Primeiro precisamos ver se há cárie, infiltração ou mordida interferindo." },
    { lead: "Elas estão escurecidas e aparecem quando eu sorrio.", agent: "Entendi. A avaliação verifica se é melhor trocar restaurações, fazer facetas/lentes em resina ou considerar porcelana. A escolha depende da estrutura do dente e do resultado que você busca." },
    { lead: "Resina mancha muito?", agent: "A resina pode alterar mais a cor que a porcelana ao longo do tempo, principalmente com café, vinho, cigarro ou higiene irregular. Em compensação, pode ser conservadora e permitir reparos mais simples quando bem indicada." },
    { lead: "E porcelana seria melhor?", agent: "Pode ser melhor se a prioridade for estabilidade de cor e durabilidade, mas não é automático. A dentista compara custo, indicação e conservação do dente. O melhor plano é o que resolve sua queixa sem exagero." },
    { lead: "Eu queria algo mais acessível inicialmente.", agent: "Faz sentido começar avaliando resina. A clínica pode montar um plano por etapas, priorizando os dentes que mais aparecem e explicando quando vale ou não investir em porcelana." },
    { lead: "Quanto custa a avaliação?", agent: "A avaliação estética custa R$ 150. O orçamento das lentes ou restaurações é fechado depois da análise, porque depende de quantidade de dentes, material e complexidade. Parcelamos no cartão." },
    { lead: "Se eu for, já consigo saber qual opção é melhor?", agent: "Sim. A ideia da avaliação é sair com clareza: se resina resolve, se porcelana é mais indicada ou se primeiro precisamos tratar algo antes da estética." },
    { lead: "Pode marcar pra mim?", agent: "Claro. Tenho terça às 10h30, quinta às 15h ou sexta às 11h. Qual desses horários você prefere?" },
    { lead: "Quinta às 15h.", agent: "Agendado, Diego. Sua avaliação estética ficou quinta às 15h. A Dra. Helena vai avaliar suas restaurações antigas e te mostrar o caminho mais seguro." },
  ]),
  conv("protese-fixa-mastigacao", "Roberto Almeida", "Prótese dentária", "whatsapp", 0, [
    { lead: "Bom dia. Estou com dificuldade pra mastigar porque perdi alguns dentes. Vocês fazem prótese?", agent: "Bom dia, Roberto! Sou a Marina, da Odonto Marques. Fazemos prótese dentária sim: fixa, removível e reabilitação sobre implantes. O melhor tipo depende de quantos dentes faltam, osso disponível e estabilidade da mordida." },
    { lead: "Eu uso uma móvel antiga, mas machuca e fica frouxa.", agent: "Quando a prótese machuca ou fica solta, pode ser desgaste da peça, mudança na gengiva ou falta de encaixe. A avaliação mostra se é caso de ajustar, trocar por uma nova ou planejar algo mais fixo." },
    { lead: "Dá pra fazer uma que não saia da boca?", agent: "Em muitos casos, sim. Pode ser uma prótese fixa apoiada em dentes ou uma prótese sobre implantes. Para saber com segurança, o doutor precisa examinar e, se necessário, pedir imagem." },
    { lead: "Tenho vergonha porque faz tempo que estou assim.", agent: "Pode ficar tranquilo. Esse tipo de caso é comum e a consulta é conduzida com respeito. O objetivo é devolver segurança para mastigar, falar e sorrir, sem julgamento." },
    { lead: "E o tratamento demora muito?", agent: "Depende do caminho. Uma prótese removível nova costuma ser mais rápida. Uma solução fixa ou sobre implantes pode ter etapas de planejamento, cirurgia e prova. A avaliação organiza esse roteiro." },
    { lead: "Consigo ter uma ideia de valor?", agent: "A avaliação custa R$ 150 e o orçamento da prótese é fechado depois do exame, porque muda conforme material, quantidade de dentes e se envolve implantes. Parcelamos no cartão e apresentamos alternativas seguras." },
    { lead: "Quero começar pela avaliação.", agent: "Excelente decisão. Tenho terça às 10h30 com o Dr. Rafael, quinta às 15h ou sexta às 11h. Qual desses funciona melhor?" },
    { lead: "Pode ser quinta às 15h.", agent: "Confirmado, Roberto. Sua avaliação de prótese ficou para quinta às 15h. Se tiver uma prótese antiga, pode trazer no dia para o doutor analisar o encaixe também." },
  ]),
  conv("protese-protocolo", "Sonia Martins", "Prótese dentária", "referral", 2, [
    { lead: "Boa tarde. Minha irmã indicou vocês. Queria saber sobre prótese fixa em cima de implantes.", agent: "Boa tarde, Sonia! Sou a Marina, da Odonto Marques. Fazemos reabilitação com prótese sobre implantes, inclusive para quem busca mais firmeza para mastigar. O primeiro passo é avaliar boca, osso, gengiva e histórico." },
    { lead: "Eu tenho dentadura em cima e quase não consigo comer direito.", agent: "Entendo. Quando a dentadura perde estabilidade, uma opção pode ser planejar implantes para sustentar uma prótese mais firme. Precisamos avaliar se há osso suficiente, se existe necessidade de enxerto e qual desenho é indicado." },
    { lead: "Essa prótese é aquela protocolo?", agent: "Pode ser, dependendo do caso. A protocolo é uma prótese fixa parafusada sobre implantes, que não é removida em casa como dentadura comum. A indicação depende da avaliação clínica e dos exames." },
    { lead: "Eu tenho medo de cirurgia.", agent: "É normal. Na consulta, o Dr. Rafael explica etapas, anestesia, exames, tempo de recuperação e alternativas. A decisão é tomada com você, e muitas vezes o tratamento pode ser planejado por fases." },
    { lead: "Fica parecendo dente natural?", agent: "O objetivo é devolver estética e função com naturalidade. A prótese considera sorriso, suporte de lábio, mordida e cor. Em reabilitação, conforto para falar e mastigar é essencial." },
    { lead: "Imagino que seja caro.", agent: "É um tratamento de maior planejamento. A avaliação custa R$ 150 e o orçamento depende de exames, quantidade de implantes e tipo de prótese. Parcelamos no cartão e apresentamos as etapas com clareza." },
    { lead: "Tem horário com o cirurgião?", agent: "Tenho terça às 10h30, quinta às 15h ou sexta às 11h com o Dr. Rafael. Qual fica melhor para você?" },
    { lead: "Quinta às 15h.", agent: "Confirmado, Sonia. Sua avaliação de prótese sobre implantes ficou quinta às 15h. Se tiver exames antigos, pode trazer; eles ajudam na conversa inicial." },
  ]),
  conv("remocao-siso-medo", "Mariana Alves", "Remoção de dentes", "whatsapp", 0, [
    { lead: "Oi! Preciso tirar um siso e estou morrendo de medo. Vocês fazem remoção de dentes?", agent: "Oi, Mariana! Sou a Marina, da Odonto Marques. Fazemos remoção de dentes e sisos sim. O primeiro passo é uma avaliação cirúrgica para ver posição do dente, raiz, proximidade com estruturas importantes e se precisa de imagem." },
    { lead: "Meu dentista antigo falou que meu siso está meio deitado.", agent: "Quando o siso está inclinado ou incluso, a avaliação é ainda mais importante. O Dr. Rafael analisa a imagem e explica grau de dificuldade, anestesia, tempo do procedimento e cuidados depois." },
    { lead: "Dói na hora?", agent: "Durante o procedimento usamos anestesia local, então a expectativa é não sentir dor, apenas pressão ou movimentação. O desconforto costuma ser no pós-operatório, com medicação e orientações para reduzir risco de inflamação." },
    { lead: "Trabalho falando o dia inteiro. Preciso ficar muitos dias parada?", agent: "Depende da complexidade e de como seu corpo reage. Para siso simples, algumas pessoas retomam mais rápido; em casos inclusos, pode ser necessário repouso maior. O cirurgião te passa uma previsão realista." },
    { lead: "Tenho que tirar todos de uma vez?", agent: "Não necessariamente. Pode ser um, dois ou mais, conforme indicação clínica, sua rotina e segurança do caso. A decisão é feita junto com você, sem pressão." },
    { lead: "E qual o valor?", agent: "A avaliação custa R$ 150. O valor da remoção é definido depois de examinar e ver a imagem, porque siso erupcionado, incluso ou próximo ao nervo muda o planejamento. Parcelamos no cartão." },
    { lead: "Quero avaliar logo porque está incomodando.", agent: "Claro. Tenho terça às 10h30, quarta às 15h ou sexta às 11h para avaliação cirúrgica. Qual horário fica melhor?" },
    { lead: "Terça às 10h30, por favor.", agent: "Pronto, Mariana. Avaliação marcada para terça às 10h30. A equipe te acompanha com calma e o Dr. Rafael explica todo o plano antes de qualquer procedimento." },
  ]),
  conv("remocao-dente-quebrado", "Lucas Ferreira", "Remoção de dentes", "whatsapp", 2, [
    { lead: "Boa noite. Quebrei um dente faz tempo e acho que vou precisar remover. Vocês avaliam isso?", agent: "Boa noite, Lucas! Sou a Marina, da Odonto Marques. Avaliamos sim. Dente quebrado nem sempre precisa ser removido; primeiro examinamos para saber se dá para recuperar, restaurar, tratar canal ou se a remoção é o caminho seguro." },
    { lead: "Ele não dói, mas está bem destruído.", agent: "Mesmo sem dor, vale avaliar. Às vezes há raiz comprometida, infiltração ou risco de infecção silenciosa. O dentista analisa estrutura restante, gengiva e necessidade de radiografia." },
    { lead: "Se tirar, fico sem dente?", agent: "Essa é uma preocupação importante. Quando a remoção é indicada, a clínica já conversa sobre reposição: provisório, implante ou outra solução, conforme o caso. A ideia é planejar a saída antes de remover." },
    { lead: "Tenho medo de aparecer sem dente no trabalho.", agent: "Entendo. Justamente por isso a avaliação olha estética e rotina. Dependendo da região e indicação, o doutor explica possibilidades para você não ser pego de surpresa." },
    { lead: "A remoção é feita no mesmo dia?", agent: "Pode acontecer em alguns casos, mas não prometemos antes de avaliar. Se precisar de exame, controle de inflamação ou planejamento de reposição, é melhor organizar antes." },
    { lead: "Qual valor da consulta?", agent: "A avaliação custa R$ 150. Se houver indicação de remoção ou outro tratamento, o orçamento é apresentado depois do exame, com possibilidade de parcelamento no cartão." },
    { lead: "Me manda os horários.", agent: "Tenho terça às 10h30, quarta às 15h e sexta às 11h para avaliação. Qual horário fica melhor?" },
    { lead: "Quarta às 15h.", agent: "Confirmado, Lucas. Sua avaliação ficou quarta às 15h na Odonto Marques. Se tiver radiografia recente, pode levar; se não tiver, a equipe te orienta no dia." },
  ]),
  conv("botox-bruxismo-estetica", "Fernanda Gomes", "Botox", "instagram", 1, [
    { lead: "Oi! Vi que vocês fazem botox. Queria saber se ajuda em bruxismo e também na testa.", agent: "Oi, Fernanda! Sou a Marina, da Odonto Marques. Fazemos botox dentro da avaliação facial. Ele pode ser indicado para suavizar linhas de expressão e como apoio em alguns casos de apertamento/bruxismo, principalmente em músculos específicos." },
    { lead: "Acordo com a mandíbula cansada e me incomodo com as linhas.", agent: "Na avaliação, a profissional observa força muscular, pontos de tensão, assimetria e expectativa estética. Para bruxismo, o botox pode reduzir hiperatividade muscular em alguns casos, mas não substitui diagnóstico completo nem placa quando indicada." },
    { lead: "Fica com cara congelada?", agent: "A proposta é resultado natural. A dose e os pontos são planejados para suavizar sem tirar sua expressão. O objetivo é deixar o rosto descansado, não mudar quem você é." },
    { lead: "Quanto tempo dura?", agent: "Em média, o efeito dura alguns meses, variando conforme metabolismo, dose, região e hábitos. A profissional explica expectativa de duração e retorno de avaliação antes da aplicação." },
    { lead: "Tem risco?", agent: "Todo procedimento tem critérios. Avaliamos histórico, contraindicações, região de aplicação e objetivo. Quando bem indicado e feito por profissional habilitado, é seguro, mas precisa ser individualizado." },
    { lead: "E quanto fica?", agent: "A avaliação custa R$ 150. O valor do botox depende das áreas, finalidade e quantidade de unidades, então é fechado após avaliação. Parcelamos no cartão e te apresentamos o plano antes de qualquer aplicação." },
    { lead: "Pode ver horário pra mim?", agent: "Tenho terça às 10h30, quinta às 15h ou sexta às 11h para avaliação de botox. Qual você prefere?" },
    { lead: "Sexta às 11h.", agent: "Confirmado, Fernanda. Sua avaliação de botox ficou para sexta às 11h na Odonto Marques. Te esperamos para montar um plano natural e seguro." },
  ]),
  conv("botox-evento-natural", "Renata Lima", "Botox", "instagram", 3, [
    { lead: "Oi, Marina. Tenho um evento no mês que vem e queria botox, mas bem natural.", agent: "Oi, Renata! Sou a Marina, da Odonto Marques. Para evento, o ideal é avaliar com antecedência para planejar pontos, dose e tempo de resultado. A proposta natural é suavizar linhas sem deixar expressão pesada." },
    { lead: "Nunca fiz. Tenho medo de ficar diferente.", agent: "Essa preocupação é comum. Na avaliação, a profissional entende o que incomoda, observa sua mímica facial e propõe uma dose conservadora quando faz sentido. Você aprova o plano antes de qualquer aplicação." },
    { lead: "Quais regiões dá pra fazer?", agent: "As regiões mais procuradas são testa, glabela, pés de galinha e, em alguns casos, pontos relacionados a sorriso gengival ou tensão muscular. A indicação depende do seu rosto e do objetivo." },
    { lead: "O resultado aparece na hora?", agent: "Não é imediato. O efeito começa nos dias seguintes e atinge melhor resultado depois de um período. Por isso é bom não deixar para a véspera do evento." },
    { lead: "Depois preciso voltar?", agent: "Normalmente existe orientação de retorno para conferir simetria e resultado. A profissional te explica o prazo ideal na consulta." },
    { lead: "Quanto preciso investir?", agent: "A avaliação custa R$ 150. O valor do botox depende das áreas e unidades necessárias, então fechamos o plano depois da avaliação. Parcelamos no cartão." },
    { lead: "Então quero avaliação essa semana.", agent: "Consigo terça às 10h30, quinta às 15h ou sexta às 11h. Qual desses horários encaixa melhor?" },
    { lead: "Terça às 10h30 pode ser.", agent: "Perfeito, Renata. Avaliação de botox marcada para terça às 10h30. A profissional vai montar um plano leve e natural pensando no seu evento." },
  ]),
  conv("lentes-porcelana-executiva", "Isabela Ramos", "Lentes de porcelana", "meta_ads", 1, [
    { lead: "Olá! Cliquei no anúncio de lentes de porcelana. Quero um sorriso mais elegante, mas discreto.", agent: "Olá, Isabela! Sou a Marina, da Odonto Marques. Lentes de porcelana melhoram formato, proporção e cor com bastante estabilidade. Quando o objetivo é elegância discreta, planejamento digital e escolha correta da cor fazem toda diferença." },
    { lead: "Não quero aquele branco exagerado.", agent: "Perfeito. A clínica trabalha com naturalidade. Na avaliação, a dentista considera tom da pele, formato do rosto, linha do sorriso e dentes vizinhos. O branco precisa conversar com você." },
    { lead: "Precisa desgastar muito o dente?", agent: "Depende do caso. Algumas situações permitem preparo mínimo; outras exigem mais ajuste para encaixe, espessura e mordida. A avaliação indica a opção mais conservadora e segura." },
    { lead: "Qual a diferença da porcelana pra resina?", agent: "A resina pode ser ótima para ajustes e costuma ter execução mais direta. A porcelana tende a ter mais resistência ao manchamento, brilho e durabilidade, mas envolve planejamento laboratorial. A dentista compara as duas no seu caso." },
    { lead: "Eu tenho uma manchinha em um dente da frente. Resolve?", agent: "Pode resolver, mas primeiro precisamos entender se a mancha é superficial, estrutural ou se há outro tratamento mais simples. Às vezes clareamento ou restauração estética já atende; em outros casos a porcelana é a melhor escolha." },
    { lead: "E o investimento?", agent: "A avaliação estética custa R$ 150. As lentes de porcelana são a partir de R$ 1.800 por dente, mas o orçamento final depende da quantidade de dentes e do planejamento. Parcelamos no cartão." },
    { lead: "Gostei. Quero marcar.", agent: "Fico feliz em ajudar. Tenho terça às 10h30, quarta às 15h ou sexta às 11h para avaliação estética. Qual funciona melhor?" },
    { lead: "Prefiro terça às 10h30.", agent: "Agendado, Isabela. Sua avaliação para lentes de porcelana ficou terça às 10h30. A Dra. Helena vai te mostrar o caminho mais natural para o resultado que você quer." },
  ]),
  conv("lentes-porcelana-fotos", "Bruna Castro", "Lentes de porcelana", "whatsapp", 3, [
    { lead: "Bom dia! Eu evito sorrir em foto porque meus dentes são pequenos. Lentes de porcelana ajudam?", agent: "Bom dia, Bruna! Sou a Marina, da Odonto Marques. Lentes de porcelana podem ajudar quando a queixa é dente pequeno, formato irregular ou proporção do sorriso. A avaliação mostra se essa é a melhor solução ou se existe algo mais simples." },
    { lead: "Meu sorriso aparece muita gengiva também.", agent: "Isso muda o planejamento. Quando há exposição gengival, a dentista avalia proporção entre dente e gengiva. Às vezes lentes resolvem parte da estética; em outros casos, pode ser necessário combinar com ajuste gengival." },
    { lead: "Queria ficar com sorriso maior, mas natural.", agent: "Esse é exatamente o tipo de expectativa que precisa de desenho personalizado. A clínica considera largura, altura, linha média, lábio e mordida. O sorriso precisa parecer seu, só mais harmônico." },
    { lead: "Quanto tempo dura porcelana?", agent: "Com boa indicação, higiene e acompanhamento, a porcelana tem alta durabilidade e estabilidade de cor. A dentista também explica cuidados com mordida, hábitos e manutenção." },
    { lead: "Tenho medo de doer.", agent: "A avaliação em si é tranquila. Se o tratamento for indicado, qualquer preparo é feito com cuidado e anestesia quando necessário. Antes disso, você entende todas as etapas." },
    { lead: "E o valor por dente?", agent: "As lentes de porcelana são a partir de R$ 1.800 por dente, e a avaliação estética custa R$ 150. O total depende de quantos dentes entram no planejamento. Parcelamos no cartão." },
    { lead: "Quero marcar com a dentista.", agent: "Tenho terça às 10h30, quarta às 15h ou sexta às 11h para avaliação com a Dra. Helena. Qual fica melhor?" },
    { lead: "Sexta às 11h é melhor.", agent: "Confirmado, Bruna. Sua avaliação com a Dra. Helena ficou sexta às 11h. Vamos olhar proporção, gengiva e possibilidades para um sorriso maior sem perder naturalidade." },
  ]),
];
