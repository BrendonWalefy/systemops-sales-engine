# AUDITORIA — Operador vs. IA (30 últimas conversas | 15/07/2026)

**Período coberto**: 06/07 a 15/07/2026 (30 conversas mais recentes por `updatedAt`)
**Fonte**: `scripts/extract-vitalli-last-30.ts` → `/tmp/vitalli-last-30.json` (banco de produção,
clínica `d24a584a-faac-4a46-9750-a718d0f8e686`)
**Status da clínica**: SHADOW MODE desde 09/07 (desligada pelo cliente após go-live antecipado —
ver [`prospect-clinica-vitalli.md`](../prospect-clinica-vitalli.md) e `VITALLI-GO-LIVE-STATUS.md`).
Isso significa: `agent`/`simulated=true` = o que a IA teria respondido, mas **nunca foi enviado**;
`clinic_user` = **Gleice**, a operadora real, respondendo de verdade pelo WhatsApp da clínica.
**Método**: comparação turno a turno entre a resposta simulada da IA e a resposta real da Gleice
para o mesmo estímulo do lead, quando ambas existem; e análise do que a IA nunca chega a fazer.

---

## RESUMO EXECUTIVO

| Métrica | Valor |
|---|---|
| Conversas analisadas | 30 |
| Conversas com ao menos 1 resposta simulada da IA | 24/30 (80%) |
| Conversas 100% respondidas só pela operadora (IA nunca compôs nada) | 6/30 (20%) |
| Latência mediana da IA (1ª resposta ao lead) | **0,9 minuto** |
| Latência mediana da operadora (1ª resposta ao lead) | **2h39min** |
| Latência média da operadora | 6,6h (10/30 leads esperaram mais de 10h) |
| Pior espera de um lead pela operadora | 22,1h |
| Conversas em que a IA chega a montar um agendamento completo (data + sinal + confirmação) | **0/30** |
| Conversas em que a IA responde preço de quantidade não-padrão (9, 16 lentes) corretamente | **0/2** |

A IA já escreve **bem** — tom cordial, gramática correta, explica a diferença técnica entre as
duas lentes de forma clara. O problema não é "a IA escreve pior que a Gleice". É que a Gleice
**fecha o funil sozinha** (cotação de quantidade não-padrão, contorno de objeção de preço antigo,
triagem clínica de caso atípico, cobrança de sinal, confirmação de agendamento) e a IA, nas 30
conversas mais recentes, **nunca chega a fazer nenhuma dessas quatro coisas**. Ela é ótima na
abertura e capenga no meio/fim do funil — exatamente onde a venda se decide.

---

## ACHADO 1 — A vantagem óbvia (velocidade) está sendo desperdiçada

A IA responde em **~1 minuto** na mediana. A Gleice responde em **~2h39min** na mediana, com
picos de 16h a 22h — ela processa a fila inteira em uma janela única de ~17h–21h30 (horário de
Brasília), todo santo dia, não importa quando o lead escreveu (00h28, 01h22, 04h15, 06h19, todos
esperaram até a próxima janela noturna). Isso já rendeu reclamação explícita de lead:

> `➢ 'Ｄｉｉｉｈ2ｋ ~★` (14/07 20:56): *"Oi esqueceu de me responder kkk"* — esperou 21h.

Esse é o ativo nº1 do produto e hoje ele vale **zero** porque a clínica está em shadow mode desde
o post-mortem de 09/07. Toda a lista de achados abaixo é a lista do que falta corrigir para poder
voltar a expor a IA ao tráfego real sem repetir o incidente do dia 09.

---

## ACHADO 2 — Identidade inconsistente: às vezes "Gleice", às vezes "assistente virtual"

Na Conversa 1 (Alex Santana), a IA responde: *"Oi, Alex! Aqui é a Gleice, da Clínica Vitalli."* — usa
a persona humana, sem se declarar bot. Mas em praticamente todas as outras 20+ conversas (Rodney,
Angel, Elizabete, Tatiana, Caua, Kah, Luiz Fernando, Giu, etc.) a abertura padrão é:

> *"Boa tarde, [Nome]. Tudo bem? Sou a assistente virtual da Clínica Vitalli."*

A Gleice de verdade **nunca** se apresenta como IA — ela sempre abre com *"Me chamo Gleice, vi que
se interessou pelos nossos casos de lentes em resina..."*, amarrando a resposta ao anúncio/caso que
o lead viu. A dissonância indica que o intent `greeting` (usado quando o lead manda algo genérico
tipo "Oi", "Bom dia") ainda está no template antigo "assistente virtual", enquanto o intent
`general_question`/pitch de lentes já foi migrado para a persona Gleice. É o mesmo padrão de bug
já registrado no post-mortem de 09/07 (guard P0.1), só que sobrevivendo em outro template.

**Ação**: unificar todos os templates de abertura para a persona "Gleice" — nunca revelar "sou uma
IA/assistente virtual" — e conferir se `greeting` e `general_question` compartilham a mesma fonte
de saudação.

---

## ACHADO 3 — A IA despeja o pitch inteiro antes de perguntar; a Gleice qualifica primeiro

Padrão repetido em ~15 conversas (Rodney, Angel, Elizabete, Tatiana, Caua, Kah, Diego, Pri, Giu...):
na primeira resposta, a IA já manda parágrafo explicando as duas técnicas **+ imagem +
vídeo de resultado**, tudo antes de o lead ter respondido qualquer coisa além do "quero saber como
transformar meu sorriso". A Gleice faz o oposto: primeira mensagem é só uma pergunta aberta —
*"me diga se tem alguma dúvida sobre o procedimento?"* — e só manda as imagens/explicação **depois**
que o lead já demonstrou o que quer saber (preço, técnica, agenda). Isso muda o ritmo da conversa
de "atendimento" para "panfleto automático", e é o mesmo padrão que já pegou reclamação em vídeo:
"fluxo de mídia promete explicação e só joga imagem+vídeo" (post-mortem 09/07, item 4).

**Ação**: mover a explicação de técnica + mídia para *depois* da primeira pergunta de
qualificação, não junto com ela. Fracionar a resposta em bolhas curtas (como a Gleice faz) em vez
de um bloco único.

---

## ACHADO 4 — Preço de quantidade não-padrão: a IA erra, e a Gleice também é inconsistente

O playbook só tem preço fechado para 10 e 20 lentes. Na prática, ~30% dos leads pedem quantidade
diferente (9, 16, "só as de cima"), e aí aparece o problema mais grave da amostra:

**Conversa 4 (Kevyn)** — contradição direta na mesma thread:
- 17h22 **Gleice**: *"O valor de 16 lentes seria de R$1.800"*
- 19h35 **IA (sombra)**, respondendo à pergunta seguinte do próprio Kevyn: *"O valor para as 16
  lentes na Técnica Estratificada é a partir de R$ 2.000"*

Se a IA estivesse no ar, o lead teria recebido dois preços diferentes para a mesma pergunta em duas
horas — exatamente o tipo de erro ("preço de lente trocado") que já derrubou a confiança do Victor
no incidente de 09/07 (ALEX: 10=R$1.800 quando era R$1.500).

**Conversa 13 (Elizabete)** — 9 lentes: Gleice responde R$1.600 (ad hoc, sem fórmula visível — não
é proporcional a 20=R$2.000). Nenhuma resposta simulada da IA existe para esse turno.

**Conversa 14 (lead sem nome)** — 10 lentes inferiores apenas: Gleice cobra R$1.700 (mais caro que
a metade de R$2.000/20, porque o lead já tem as superiores) e explica que a promo de R$2.000 vale
só para os 20 dentes. De novo, sem resposta simulada da IA nesse turno.

Isso não é só um bug de prompt — é um **buraco de dado**: nem a Gleice segue uma fórmula linear
(9=1.600, 10-inf=1.700, 16=1.800, 20=2.000 não é proporcional entre si), então a IA não tem como
"deduzir" isso, ela precisa de uma tabela explícita de preços por quantidade comum, extraída do
histórico real de cotações da Gleice — não de uma extrapolação matemática do preço de 20 unidades.

**Ação**: (1) levantar com o Victor/Gleice uma tabela de preço por quantidade (9, 10, 16, 20, e
"só superior"/"só inferior"), (2) até essa tabela existir, a IA deve responder "depende da
quantidade exata, vou confirmar com a equipe" em vez de calcular/advinhar — errar por omissão é
mais barato que errar por contradição.

---

## ACHADO 5 — Objeção de preço antigo/promoção passada: só a Gleice sabe contornar

**Conversa 16 (Marcel)**: o lead lembra de uma cotação anterior mais barata (*"vcs tinham me
passado um valor legal... acho que era parcelado, ficava 10 de 200 e pouquinho"*). A Gleice
reconhece o histórico e maneja a objeção: *"Seria um valor promocional daquela época... conseguimos
manter por R$2.200."* Não há nenhum turno simulado da IA cobrindo esse tipo de objeção em toda a
amostra — o playbook atual não tem memória de "promoções passadas" nem instrução de como responder
quando um lead cita um preço antigo. É o mesmo território do achado já registrado em memória
("garantia-objeção-não-surge" — a IA ignora objeção cadastrada e pivota pra avaliação).

**Ação**: adicionar ao playbook uma resposta-padrão para "preço antigo/promoção que você me
passou antes" (reconhecer, explicar que promoções têm validade, oferecer o preço vigente com uma
concessão pequena se fizer sentido comercialmente) — hoje esse caminho de conversa não existe.

---

## ACHADO 6 — Caso clínico atípico: a IA empurra o pitch padrão, a Gleice faz triagem

**Conversa 19 (Gaab)**: lead manda foto de dois dentes fraturados, só com raiz, e diz que outro
dentista indicou ponte fixa. A IA responde de forma genérica: *"Entendo... as lentes de resina
também podem transformar o sorriso... qual desses dois resultados chamou mais a sua atenção?"* —
ignora a complexidade clínica e tenta redirecionar para o pitch padrão de lentes. A Gleice, ao
assumir a conversa, faz a pergunta clinicamente correta: *"Você teria uma radiografia dos dentes?"*
— e só depois cota o valor da prótese fixa (R$1.000 + lentes).

**Ação**: adicionar um guard de "caso atípico" (menção a fratura, raiz exposta, prótese, ponte,
extração) que interrompe o pitch padrão de lentes e pede a informação clínica que o dentista
precisa (raio-x, foto do dente por dentro) antes de qualquer cotação — hoje a IA não distingue
"lead quer estética" de "lead tem problema clínico não resolvido".

---

## ACHADO 7 — Metade final do funil (agendamento → sinal → confirmação) é 100% Gleice

Em nenhuma das 30 conversas a mensagem simulada da IA chega a: oferecer uma data que bate com a
agenda real, pedir o sinal de R$30 via Pix, confirmar o agendamento com endereço/estacionamento/
tolerância de atraso, ou responder "posso levar acompanhante?". Isso bate com o achado antigo
("zero agendamentos pela conversa") — 6 dias depois, continua zero. Só que agora dá pra ver o
motivo mais claro: quando a IA chega a oferecer horários (Conversa 4, Kevyn), ela sugere slots
("Qui 16/07 às 12h"..." que não têm nenhuma relação com os que a Gleice realmente usa minutos
depois ("15.08 às 9:00/16:00... 22.08 às 16:00...") — os horários da IA parecem templates fixos,
não uma consulta à agenda real.

A boa notícia: as mensagens de confirmação da Gleice (endereço, sinal, "evitar levar
acompanhante", tolerância de atraso) são **99% copy-paste idênticas** entre conversas — ou seja,
são exatamente o tipo de mensagem que o pipeline já composta de forma determinística (regra do
"o sistema decide, a LLM verbaliza"). O gap não é de criatividade, é de **acionamento**: o intent
de "lead escolheu uma data" e "sinal foi comprovado" precisa disparar essas mensagens fixas
automaticamente, com a data real da agenda.

**Ação (maior alavanca de conversão da lista)**: verificar por que o intent `book_appointment` não
está puxando slots reais da agenda nessas 24 conversas, e por que a sequência sinal→confirmação
nunca dispara em shadow mode — isso é o pedaço do funil com menor risco de "alucinar" (é tudo
texto fixo + data real) e maior retorno, porque é literalmente onde a venda fecha.

---

## ACHADO 8 — Nome de exibição do WhatsApp usado sem filtro

Conversa 18: lead tem nome de exibição "ocupado" (provavelmente status do WhatsApp, não nome
próprio). A IA cumprimenta: *"Boa tarde, ocupado. Tudo bem?"* — soa estranho/robótico. A Gleice
nunca usa o nome de exibição do WhatsApp — ela sempre cumprimenta genérico ("Olá, tudo bem?").

**Ação**: sanitizar o campo nome antes de usar em saudação — descartar nomes que parecem status,
apelidos com só emoji, ou palavras comuns do português (não é um fix urgente, mas é rápido e
barato).

---

## ACHADO 9 — Mensagem duplicada do lead gera dois pitches completos

Conversa 21 (Diego Almeida): o lead manda a mesma mensagem de abertura duas vezes (19h05 e 20h14,
provavelmente reenvio acidental do WhatsApp). A IA responde às duas com dois pitches completos e
diferentes entre si — nenhuma detecção de repetição. Numa conversa real isso pareceria a IA "não
prestando atenção" no que já foi dito.

**Ação**: dedupe de mensagem idêntica/quase-idêntica do lead dentro da mesma janela de sessão
antes de gerar uma resposta nova do zero.

---

## PRIORIZAÇÃO

| # | Achado | Prioridade | Por quê |
|---|---|---|---|
| 7 | Funil de agendamento não fecha (sinal/confirmação) | **P0** | É onde a venda se decide; é texto determinístico, baixo risco, alto retorno |
| 4 | Preço de quantidade não-padrão contraditório | **P0** | Já causou perda de confiança do cliente uma vez (09/07); se repetir, é fatal pra reconquista |
| 2 | Persona inconsistente ("assistente virtual" vazando) | **P0** | Mesma classe de bug do guard P0.1 que já bloqueou o go-live antes |
| 6 | Sem triagem clínica em caso atípico | P1 | Baixo volume, mas alto risco de resposta clinicamente errada |
| 5 | Sem contorno de objeção de preço antigo | P1 | Afeta reconversão de leads antigos/recorrentes |
| 3 | Pitch despejado antes de qualificar | P1 | Prejudica percepção de "atendimento humano" |
| 9 | Sem dedupe de mensagem repetida | P2 | Cosmético, mas fácil de corrigir |
| 8 | Nome de exibição sem sanitização | P2 | Cosmético, fácil de corrigir |

---

## Nota metodológica

Esta auditoria reusa a metodologia de `01-auditoria-20-conversas.md` (09/07), mas com N maior (30
vs. 20) e sobre um período mais recente (a amostra atual é quase toda do próprio dia 15/07 — a fila
da Gleice está sempre "quente" com o dia corrente porque ela zera a fila numa janela única à noite).
Dados brutos em `/tmp/vitalli-last-30.json` (não versionado — reextrair com
`npx dotenv -e .env.local -- npx tsx scripts/extract-vitalli-last-30.ts` se precisar reabrir a
análise).
