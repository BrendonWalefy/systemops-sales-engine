/**
 * Roteiros curados da clínica demo "Odonto Marques" — v2 "cenário perfeito".
 *
 * A demo prioriza 10 conversas completas ponta a ponta em vez de muitas threads
 * rasas. Cada caso conta uma história com desfecho próprio:
 *   - lead cita a ORIGEM (anúncio Instagram/Google, indicação) na abertura;
 *   - a Marina explica o procedimento, responde 1-2 objeções reais e fecha
 *     horário → escolha → confirmação;
 *   - alguns turnos saem em ÁUDIO B-WAVE (`voice`) e outros anexam VÍDEO/FOTO
 *     da biblioteca de mídia (`media` + `mediaQuery`);
 *   - desfechos variados: agendado/confirmado, ganho com valor fechado, resgate
 *     por follow-up automático, handoff para humano e atendimento fora do horário.
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

export type DemoAppointmentSpec = {
  status: "scheduled" | "confirmed" | "completed";
  /** Sobrescreve o valor do appointment (ganhos com plano fechado). */
  valueCents?: number;
};

export type DemoFollowUpSpec = {
  /** "done" = follow-up que JÁ resgatou o lead; "pending" = aguardando disparo. */
  status: "pending" | "done";
  reason: string;
};

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
  daysAgo: number;
  appointment?: DemoAppointmentSpec;
  followUp?: DemoFollowUpSpec;
  turns: DemoTurn[];
};

function conv(
  key: string,
  leadName: string,
  treatment: string,
  channel: DemoChannel,
  daysAgo: number,
  turns: DemoTurn[],
  overrides: Partial<DemoConversationSpec> = {},
): DemoConversationSpec {
  return {
    key,
    leadName,
    treatment,
    channel,
    status: "appointment_scheduled",
    temperature: "hot",
    booked: true,
    daysAgo,
    turns,
    ...overrides,
  };
}

export const DEMO_CONVERSATIONS: DemoConversationSpec[] = [
  // 1) Instagram Ads → lentes de resina p/ casamento · ÁUDIO + VÍDEO · confirmada
  conv("lentes-resina-noiva", "Camila Rocha", "Lentes de resina", "instagram", 0, [
    {
      lead: "Oi, boa tarde! Vi o anúncio de vocês no Instagram sobre lentes 😍 Vou me casar em outubro e queria muito melhorar meu sorriso. Vocês fazem?",
      agent: "Boa tarde, Camila! Que fase especial, parabéns pelo casamento 🤍 Sou a Marina, da Odonto Marques. Fazemos sim: lentes em resina e em porcelana. Para noivas, o segredo é planejar com antecedência — cor, formato e quantos dentes aparecem no seu sorriso. Posso te explicar as opções?",
    },
    {
      lead: "Pode sim! Só tenho medo de ficar com aquele sorriso artificial, sabe?",
      agent: "Entendo perfeitamente, Camila — essa é a preocupação mais comum e a mais importante. Aqui o planejamento respeita o formato do seu rosto e o seu sorriso natural: a ideia é as pessoas notarem que você está mais bonita, sem saber exatamente o porquê. A Dra. Helena faz o desenho digital antes, então você vê o resultado antes de decidir qualquer coisa.",
      voice: true,
    },
    {
      lead: "Ai que bom! Tem como eu ver como funciona?",
      agent: "Tem sim! Te enviei um vídeo mostrando como funciona o planejamento das lentes aqui na clínica. Repara como o resultado mantém a naturalidade de cada paciente 😊",
      media: "video",
      mediaQuery: "lente",
    },
    {
      lead: "Amei o vídeo! E quanto custa mais ou menos?",
      agent: "As lentes em resina são a partir de R$ 950 por dente, e o valor final depende de quantos dentes entram no planejamento. O primeiro passo é a avaliação estética, que custa R$ 150 — nela a Dra. Helena desenha seu caso e fecha o orçamento certinho. E parcelamos no cartão, viu?",
    },
    {
      lead: "Meu casamento é em outubro, dá tempo?",
      agent: "Dá tempo com folga! Outubro é um ótimo prazo para planejar sem correria. Se estiver tudo saudável, seguimos direto; se precisar de limpeza ou clareamento antes, organizamos a sequência certa para chegar no grande dia com o sorriso pronto.",
    },
    {
      lead: "Então quero marcar essa avaliação!",
      agent: "Perfeito, Camila! Tenho terça às 10h30, quarta às 15h ou sexta às 11h com a Dra. Helena. Qual fica melhor para você?",
    },
    {
      lead: "Quarta às 15h fica ótimo!",
      agent: "Agendado! ✅ Sua avaliação estética ficou para quarta às 15h com a Dra. Helena, aqui na Odonto Marques. Vamos planejar seu sorriso com calma para o casamento.",
    },
    {
      lead: "Obrigada, Marina! Você me atendeu super bem ❤️",
      agent: "Imagina, Camila! Foi um prazer 🤍 Qualquer dúvida antes da consulta, é só me chamar por aqui. Te esperamos quarta!",
    },
  ], { appointment: { status: "confirmed" } }),

  // 2) Anúncio no Google → lentes de porcelana executiva · VÍDEO · agendada
  conv("lentes-porcelana-executiva", "Isabela Ramos", "Lentes de porcelana", "meta_ads", 1, [
    {
      lead: "Olá! Pesquisei lentes de porcelana no Google e cliquei no anúncio de vocês. Quero um sorriso mais elegante, mas discreto — nada exagerado.",
      agent: "Olá, Isabela! Seja bem-vinda 😊 Sou a Marina, da Odonto Marques. Você veio ao lugar certo: nosso foco em porcelana é justamente elegância com naturalidade. O planejamento considera tom de pele, formato do rosto e linha do sorriso — o branco precisa conversar com você.",
    },
    {
      lead: "Não quero aquele branco de porcelanato, sabe? 😅",
      agent: "Haha, pode deixar que aqui não fazemos 'sorriso de porcelanato' 😄 A Dra. Helena trabalha com escala de cor personalizada e desenho digital: você aprova a simulação antes de qualquer procedimento. Quer ver como fica na prática?",
    },
    {
      lead: "Quero sim!",
      agent: "Te enviei um vídeo de um planejamento digital feito aqui na clínica — repara como o resultado é sofisticado sem perder a identidade do sorriso.",
      media: "video",
      mediaQuery: "porcelana",
    },
    {
      lead: "Ficou lindo. Precisa desgastar muito o dente?",
      agent: "Depende do caso, e essa é uma decisão técnica importante. Algumas situações permitem preparo mínimo; outras pedem mais ajuste por causa do encaixe e da mordida. Na avaliação, a Dra. Helena sempre indica o caminho mais conservador possível para o resultado que você quer.",
    },
    {
      lead: "E o investimento?",
      agent: "As lentes de porcelana são a partir de R$ 1.800 por dente, e o orçamento final depende de quantos dentes entram no planejamento. A avaliação estética custa R$ 150 e já sai com o desenho do seu caso. Parcelamos no cartão e a doutora monta opções por prioridade.",
    },
    {
      lead: "Gostei da forma como vocês explicam. Quero marcar.",
      agent: "Fico feliz, Isabela! 😊 Tenho terça às 10h30, quarta às 15h ou sexta às 11h com a Dra. Helena. Qual funciona melhor na sua agenda?",
    },
    {
      lead: "Sexta às 11h, por favor.",
      agent: "Agendado! ✅ Sua avaliação para lentes de porcelana ficou sexta às 11h com a Dra. Helena. Vou te enviar um lembrete um dia antes. Até sexta!",
    },
    {
      lead: "Perfeito, obrigada!",
      agent: "Por nada! Qualquer dúvida até lá, estou por aqui 🤍",
    },
  ]),

  // 3) Indicação → prótese protocolo · ÁUDIO (medo de cirurgia) · confirmada
  conv("protese-protocolo-indicacao", "Sonia Martins", "Prótese dentária", "referral", 2, [
    {
      lead: "Boa tarde. Minha irmã fez tratamento aí e me indicou vocês. Queria saber sobre aquela prótese fixa em cima de implantes.",
      agent: "Boa tarde, Sonia! Que alegria receber a indicação da sua irmã 🤍 Sou a Marina, da Odonto Marques. Fazemos sim a reabilitação com prótese sobre implantes — a chamada protocolo, que é fixa e devolve firmeza para mastigar. O primeiro passo é avaliar boca, osso e histórico com o Dr. Rafael.",
    },
    {
      lead: "Eu uso dentadura e quase não consigo comer direito. Carne então, nem pensar.",
      agent: "Imagino o quanto isso pesa no dia a dia, Sonia. É exatamente esse tipo de caso que a protocolo transforma: por ser parafusada sobre implantes, ela não sai do lugar como a dentadura. Voltar a comer com segurança — inclusive carne — é o objetivo do tratamento.",
    },
    {
      lead: "Mas tenho muito medo de cirurgia, pra ser sincera.",
      agent: "Pode ficar tranquila, esse medo é super comum e ninguém aqui ignora ele. O Dr. Rafael explica cada etapa antes: anestesia, exames, tempo de recuperação e alternativas. Nada é decidido sem você entender e concordar — e muitas vezes o tratamento é planejado por fases, no seu ritmo.",
      voice: true,
    },
    {
      lead: "Minha irmã falou que o doutor tem muita paciência mesmo.",
      agent: "Tem sim, e com casos de reabilitação ele faz questão de ir com calma 😊 Na avaliação ele examina, pede a imagem se precisar e monta o plano completo com você. Se tiver exames antigos, pode trazer que ajudam na conversa.",
    },
    {
      lead: "Imagino que não seja barato, né?",
      agent: "É um tratamento de maior planejamento, sim. A prótese é a partir de R$ 2.400 e o orçamento fechado depende dos exames e da quantidade de implantes. A avaliação custa R$ 150, parcelamos no cartão e o doutor apresenta as etapas com total clareza — sem surpresa no meio do caminho.",
    },
    {
      lead: "Está bom. Tem horário com ele essa semana?",
      agent: "Tenho terça às 10h30, quinta às 15h ou sexta às 11h com o Dr. Rafael. Qual fica melhor para a senhora?",
    },
    {
      lead: "Quinta às 15h.",
      agent: "Confirmado, Sonia! ✅ Sua avaliação com o Dr. Rafael ficou quinta às 15h. Traga seus exames antigos se tiver, e pode vir com a sua irmã se quiser companhia 🤍",
    },
    {
      lead: "Vou levar ela sim! Obrigada, Marina.",
      agent: "Combinado! Vai ser um prazer receber as duas. Até quinta! 😊",
    },
  ], { appointment: { status: "confirmed" } }),

  // 4) WhatsApp → siso com medo · GANHO (extração realizada e paga)
  conv("remocao-siso-won", "Mariana Alves", "Remoção de dentes", "whatsapp", 9, [
    {
      lead: "Oi! Preciso tirar um siso e estou morrendo de medo 😖 Vocês fazem remoção?",
      agent: "Oi, Mariana! Pode respirar fundo que você está em boas mãos 😊 Sou a Marina, da Odonto Marques. Fazemos sim, e o primeiro passo é uma avaliação com o Dr. Rafael para ver a posição do dente e explicar tudinho antes de qualquer procedimento.",
    },
    {
      lead: "Meu dentista antigo falou que ele tá meio deitado. Isso complica?",
      agent: "Quando o siso está inclinado, a avaliação com imagem é ainda mais importante — o Dr. Rafael analisa a posição exata, o grau de dificuldade e monta o plano com segurança. Complicar, não necessariamente: só muda o planejamento.",
    },
    {
      lead: "E dói? Me conta a verdade 😅",
      agent: "Verdade verdadeira: durante o procedimento você não sente dor, só pressão — a anestesia local cuida disso. O desconforto fica para o pós-operatório, e aí você sai daqui com medicação certinha e todas as orientações. A maioria dos pacientes fala 'era só isso?' no final 😄",
    },
    {
      lead: "Hahaha tomara! Quanto custa?",
      agent: "A avaliação custa R$ 150. A remoção é a partir de R$ 650 e o valor exato sai depois da imagem, porque siso deitado muda o planejamento. Parcelamos no cartão, tá?",
    },
    {
      lead: "Bora então, quero marcar logo antes que eu desista 😂",
      agent: "Essa é a atitude! 😂 Tenho terça às 10h30, quarta às 15h ou sexta às 11h com o Dr. Rafael. Qual prefere?",
    },
    {
      lead: "Terça às 10h30.",
      agent: "Agendado! ✅ Avaliação terça às 10h30 com o Dr. Rafael. Ele vai te explicar todo o plano antes de qualquer coisa — e eu te mando um lembrete no dia anterior 😊",
    },
    {
      lead: "Marina, passei aqui só pra agradecer! Tirei o siso com o Dr. Rafael e foi MUITO mais tranquilo do que eu imaginava 🙏",
      agent: "Mariana, que notícia boa! 🤍 Fico feliz demais. Segue as orientações do pós-operatório e, qualquer coisa fora do esperado, me chama aqui na hora, combinado?",
      gapMinutes: 60 * 24 * 6, // 6 dias depois: pós-procedimento
    },
    {
      lead: "Combinado! Vocês estão de parabéns pelo atendimento.",
      agent: "Obrigada pelo carinho! 😊 Te esperamos no retorno para o Dr. Rafael conferir a cicatrização. Melhoras!",
    },
  ], { status: "won", temperature: null, appointment: { status: "completed", valueCents: 65000 } }),

  // 5) Meta Ads → implante · lead esfriou e o FOLLOW-UP AUTOMÁTICO resgatou · VÍDEO
  conv("implante-follow-up-resgate", "Ricardo Menezes", "Implante dentário", "meta_ads", 5, [
    {
      lead: "Boa tarde. Vi o anúncio de vocês no Facebook. Perdi um dente de baixo faz uns meses e queria saber do implante.",
      agent: "Boa tarde, Ricardo! Sou a Marina, da Odonto Marques. Fez muito bem em procurar: quando o espaço fica muito tempo sem dente, os vizinhos podem se movimentar. O implante repõe a raiz com um pino de titânio e devolve o dente fixo, com aparência natural.",
    },
    {
      lead: "E como funciona? Tenho receio de ser muito invasivo.",
      agent: "Te enviei um vídeo curtinho mostrando as etapas do implante aqui na clínica — da avaliação ao dente final. O Dr. Rafael faz tudo com planejamento digital, o que deixa o procedimento bem mais previsível e tranquilo.",
      media: "video",
      mediaQuery: "implante",
    },
    {
      lead: "Entendi. E o valor?",
      agent: "O implante é a partir de R$ 2.900, incluindo o pino. O valor fechado depende da avaliação e da imagem, porque cada caso tem um planejamento. A avaliação custa R$ 150 e parcelamos tudo no cartão.",
    },
    {
      lead: "Hmm, entendi. Vou pensar e te falo, ok?",
      agent: "Claro, Ricardo! Sem pressa nenhuma 😊 Vou deixar seu contato aqui comigo e, se quiser, te aviso quando abrirem novos horários com o Dr. Rafael. Qualquer dúvida sobre o procedimento, é só chamar!",
    },
    {
      lead: "",
      agent: "Oi, Ricardo! Aqui é a Marina, da Odonto Marques 😊 Passando para saber se ainda faz sentido seguirmos com a sua avaliação do implante — abriram novos horários com o Dr. Rafael esta semana. Quer que eu te envie as opções?",
      gapMinutes: 60 * 24 * 2, // follow-up automático 2 dias depois
    },
    {
      lead: "Oi, Marina! Que bom que me chamou, eu tava mesmo enrolando pra te responder 😅 Pode me mandar sim.",
      agent: "Que ótimo! 😄 Tenho terça às 10h30, quinta às 15h ou sexta às 11h com o Dr. Rafael. Qual encaixa melhor pra você?",
    },
    {
      lead: "Quinta às 15h fica bom.",
      agent: "Agendado! ✅ Sua avaliação do implante ficou quinta às 15h com o Dr. Rafael. Se tiver alguma radiografia antiga, pode trazer que ajuda no planejamento. Te mando um lembrete antes!",
    },
    {
      lead: "Show, obrigado!",
      agent: "Por nada, Ricardo! Até quinta 😊",
    },
  ], { followUp: { status: "done", reason: "reengajamento" } }),

  // 6) Instagram Ads → botox p/ evento · ÁUDIO · confirmada
  conv("botox-evento-natural", "Renata Lima", "Botox", "instagram", 1, [
    {
      lead: "Oi! Vi os stories de vocês no Instagram. Tenho um casamento pra ir mês que vem e queria botox, mas beeem natural.",
      agent: "Oi, Renata! Sou a Marina, da Odonto Marques 😊 Veio na hora certa: para evento, o ideal é aplicar com algumas semanas de antecedência, porque o efeito completo aparece nos dias seguintes. E pode ficar tranquila — natural é a nossa especialidade.",
    },
    {
      lead: "Nunca fiz. Morro de medo de ficar com cara congelada 😂",
      agent: "Essa preocupação é a mais comum, e olha: quem faz com o Dr. André não fica congelada, fica descansada 😄 Ele estuda a sua mímica facial antes e propõe uma dose conservadora. A proposta é suavizar as linhas sem tirar a sua expressão — o rosto continua sendo seu.",
      voice: true,
    },
    {
      lead: "Adorei isso! Quais regiões dá pra fazer?",
      agent: "As mais procuradas são testa, glabela (aquela linha entre as sobrancelhas) e pés de galinha. Na avaliação, o Dr. André observa o que realmente incomoda você e monta o plano só com o necessário.",
    },
    {
      lead: "E quanto custa?",
      agent: "O botox é a partir de R$ 890, dependendo das áreas e unidades. A avaliação custa R$ 150 e você aprova o plano antes de qualquer aplicação. Parcelamos no cartão 😊",
    },
    {
      lead: "Fechou! Quero marcar essa semana ainda.",
      agent: "Consigo sim! Tenho terça às 10h30, quinta às 15h ou sexta às 11h com o Dr. André. Qual prefere?",
    },
    {
      lead: "Terça às 10h30!",
      agent: "Agendado! ✅ Sua avaliação de botox ficou terça às 10h30 com o Dr. André. Ele vai montar um plano leve e natural pensando no seu evento 🤍",
    },
    {
      lead: "Perfeito! Já tô ansiosa hahaha",
      agent: "Vai dar tudo certo! 😄 Te espero terça. Qualquer dúvida até lá, é só chamar!",
    },
  ], { appointment: { status: "confirmed" } }),

  // 7) WhatsApp → caso clínico complexo · HANDOFF para humano · precisa de atenção
  conv("handoff-caso-complexo", "Antônio Ferraz", "Prótese dentária", "whatsapp", 0, [
    {
      lead: "Boa tarde. Preciso trocar minha prótese, mas tive um infarto há 4 meses e tomo anticoagulante. Queria saber se posso fazer o procedimento.",
      agent: "Boa tarde, Antônio! Sou a Marina, da Odonto Marques. Obrigada por me contar isso logo de início — é uma informação muito importante. Casos com histórico cardíaco recente e anticoagulante precisam da orientação direta da nossa equipe clínica, então vou acionar o Dr. Rafael para falar com o senhor por aqui, tudo bem?",
    },
    {
      lead: "Tudo bem, agradeço. É que estou preocupado se é seguro.",
      agent: "Preocupação mais do que compreensível, e o senhor fez certo em perguntar antes. Já sinalizei seu caso como prioridade para o Dr. Rafael — ele vai te orientar pessoalmente ainda hoje. Enquanto isso, fico por aqui para qualquer outra dúvida 🤍",
      human:
        "Boa tarde, Antônio! Aqui é o Dr. Rafael Nogueira. Vi seu caso com a Marina. Com anticoagulante e infarto recente, seguimos um protocolo específico junto com o seu cardiologista — é seguro sim, desde que planejado. Vou te ligar ainda hoje para entender seu histórico e combinarmos a avaliação, pode ser?",
    },
    {
      lead: "Pode sim, doutor! Fico no aguardo da ligação. Muito obrigado pela atenção de vocês.",
      agent: "Nós que agradecemos a confiança, Antônio! O Dr. Rafael te liga ainda hoje. Qualquer coisa antes disso, estou por aqui 😊",
    },
  ], {
    status: "in_conversation",
    booked: false,
    needsAttention: true,
    attentionReason: "Caso clínico complexo: paciente cardíaco em uso de anticoagulante — Dr. Rafael assumiu",
    aiPaused: true,
  }),

  // 8) Google → alinhadores às 22h47 · FORA DO HORÁRIO · confirmada
  conv("alinhadores-fora-horario", "Thiago Sampaio", "Alinhadores invisíveis", "whatsapp", 2, [
    {
      lead: "Boa noite! Sei que é tarde 😅 Pesquisei alinhador invisível no Google e achei vocês. Atendem por mensagem a essa hora?",
      agent: "Boa noite, Thiago! Pode falar comigo a qualquer hora — eu não durmo, prometo 😄 Sou a Marina, assistente da Odonto Marques. Me conta: o que te incomoda hoje no seu sorriso?",
    },
    {
      lead: "Meus dentes de baixo são bem tortos e eu não quero usar aparelho fixo de jeito nenhum. Trabalho com atendimento ao público.",
      agent: "Entendi perfeitamente! Os alinhadores invisíveis são exatamente para o seu perfil: transparentes, removíveis para comer e escovar, e quase imperceptíveis no dia a dia. Aqui quem cuida é a Dra. Camila, nossa ortodontista.",
    },
    {
      lead: "E quanto custa esse tratamento?",
      agent: "Os alinhadores são a partir de R$ 350 por mês, e o valor fechado depende da complexidade do caso — isso a Dra. Camila define na avaliação, que custa R$ 150 e já inclui o escaneamento do seu sorriso.",
    },
    {
      lead: "Mais barato do que eu imaginava. Quanto tempo demora o tratamento?",
      agent: "Varia bastante com o caso: correções mais simples podem levar poucos meses, casos completos passam de um ano. Na avaliação você já sai sabendo a estimativa para o SEU sorriso, sem achismo 😊",
    },
    {
      lead: "Show. Consigo marcar já por aqui?",
      agent: "Consegue sim, agora mesmo! Tenho terça às 10h30, quarta às 15h ou sexta às 11h com a Dra. Camila. Qual fica melhor?",
    },
    {
      lead: "Quarta às 15h.",
      agent: "Agendado! ✅ Sua avaliação ficou quarta às 15h com a Dra. Camila. Vou te enviar um lembrete um dia antes. Boa noite e bom descanso, Thiago! 😴",
    },
    {
      lead: "Boa noite, Marina! Atendimento nota 10, viu?",
      agent: "Obrigada, Thiago! 🤍 Até quarta!",
    },
  ], { afterHours: true, temperature: "warm", appointment: { status: "confirmed" } }),

  // 9) WhatsApp → clareamento · REMARCAÇÃO sem fricção · confirmada
  conv("clareamento-remarcacao", "Juliana Castro", "Clareamento dental", "whatsapp", 4, [
    {
      lead: "Oi! Minha formatura é daqui a 3 semanas e queria fazer um clareamento. Dá tempo?",
      agent: "Oi, Juliana! Dá tempo sim — 3 semanas é um ótimo prazo 😊 Sou a Marina, da Odonto Marques. Fazemos clareamento a laser aqui na clínica (resultado mais rápido) ou com moldeiras para usar em casa. Para formatura, o a laser costuma ser o queridinho.",
    },
    {
      lead: "E não vai deixar meus dentes sensíveis? Tenho um pouco de medo disso.",
      agent: "Boa pergunta! Pode haver uma sensibilidade leve e passageira nos primeiros dias, mas a Dra. Helena usa protocolo com dessensibilizante e ajusta a intensidade para o seu caso. Na avaliação ela confere seu esmalte antes — segurança primeiro, sempre.",
    },
    {
      lead: "Quanto custa?",
      agent: "O clareamento é a partir de R$ 690, e a avaliação custa R$ 150. Se estiver tudo certinho com seus dentes, dá até para sair da avaliação já com a primeira sessão marcada. Parcelamos no cartão 😊",
    },
    {
      lead: "Perfeito! Pode marcar pra mim?",
      agent: "Claro! Tenho terça às 10h30, quarta às 15h ou sexta às 11h com a Dra. Helena. Qual prefere?",
    },
    {
      lead: "Quarta às 15h!",
      agent: "Agendado! ✅ Sua avaliação ficou quarta às 15h com a Dra. Helena. Te mando um lembrete antes 😊",
    },
    {
      lead: "Marina, me perdoa 🙈 surgiu uma reunião no trabalho justo quarta à tarde. Consigo mudar o horário?",
      agent: "Imagina, Juliana, acontece! 😊 Sem problema nenhum. Consigo te encaixar sexta às 11h ou na terça seguinte às 10h30 — qual fica melhor?",
      gapMinutes: 60 * 24, // no dia seguinte
    },
    {
      lead: "Sexta às 11h fica perfeito!",
      agent: "Prontinho, remarcado! ✅ Sua avaliação agora é sexta às 11h com a Dra. Helena. O horário de quarta já foi liberado, pode ficar tranquila. Até sexta! 🤍",
    },
    {
      lead: "Você é demais, obrigada!",
      agent: "Por nada! 😄 Boa reunião na quarta e até sexta!",
    },
  ], { appointment: { status: "confirmed" } }),

  // 10) Meta Ads → resina vs porcelana · GANHO alto (8 lentes fechadas na avaliação)
  conv("porcelana-plano-fechado", "Larissa Monteiro", "Lentes de porcelana", "meta_ads", 8, [
    {
      lead: "Oi! Vi o anúncio de vocês e fiquei na dúvida: qual a diferença entre lente de resina e de porcelana? Não sei qual faz mais sentido pra mim.",
      agent: "Oi, Larissa! Excelente pergunta — e é ótimo você decidir isso bem informada 😊 Sou a Marina, da Odonto Marques. Resumindo: a resina é mais acessível e ótima para ajustes pontuais; a porcelana tem mais durabilidade, brilho e estabilidade de cor ao longo dos anos. A escolha certa depende do seu caso e da sua expectativa.",
    },
    {
      lead: "Eu quero algo definitivo, sabe? Cansei de ficar refazendo coisas nos dentes.",
      agent: "Então a porcelana provavelmente é o seu caminho — é justamente o perfil dela: resultado de longo prazo, com menos manutenção. Mas quem confirma é a Dra. Helena na avaliação, olhando esmalte, mordida e o resultado que você busca. Aqui a indicação é técnica, não comercial 😊",
    },
    {
      lead: "Gostei dessa postura. Quanto custa cada uma?",
      agent: "A resina é a partir de R$ 950 por dente e a porcelana a partir de R$ 1.800 por dente. A avaliação estética custa R$ 150 e já inclui o estudo do seu sorriso — você sai sabendo exatamente quantos dentes precisam e o valor fechado. Parcelamos no cartão.",
    },
    {
      lead: "Fechado, quero fazer essa avaliação.",
      agent: "Perfeito! Tenho terça às 10h30, quarta às 15h ou sexta às 11h com a Dra. Helena. Qual fica melhor?",
    },
    {
      lead: "Terça às 10h30.",
      agent: "Agendado! ✅ Sua avaliação estética ficou terça às 10h30 com a Dra. Helena. Ela vai comparar as duas opções no SEU caso, com simulação digital. Até terça! 😊",
    },
    {
      lead: "Marina!! Saí agora da consulta e FECHEI o plano das 8 lentes de porcelana com a Dra. Helena 😍 A simulação digital me convenceu na hora.",
      agent: "Larissa, que notícia MARAVILHOSA! 🤩 A Dra. Helena já me passou seu plano. Vou te enviar o cronograma das sessões e o lembrete de cada etapa por aqui, combinado? Seu sorriso novo vem aí! 🤍",
      gapMinutes: 60 * 24 * 3, // 3 dias depois: pós-avaliação
    },
    {
      lead: "Combinado! Ansiosa demais. Obrigada por todo o atendimento, você foi incrível desde o primeiro oi!",
      agent: "Ahh, obrigada! 🥹 Estarei com você em cada etapa até o sorriso final. Qualquer dúvida no caminho, já sabe onde me encontrar 😊",
    },
  ], { status: "won", temperature: null, appointment: { status: "completed", valueCents: 1_440_000 } }),
];
