# Backlog — Reunião com Dr. Victor (Vitalli), 17/07/2026

Pontos trazidos pelo Victor na reunião de 17/07, cruzados com o comportamento
atual do código (análise feita no mesmo dia; testes dos módulos afetados verdes —
105 testes: sinal, quantidade, janelas, lembretes, takeover, follow-up).

Classificação na triagem, mesmo padrão do `todos-nc-beauty.md`:
**[COBERTO]** o produto já faz — só validar/ativar · **[CONFIG]** ação de
configuração para esta clínica, sem código · **[COPY]** ajuste de texto
determinístico (código, mas trivial) · **[PRODUTO]** melhoria em algo que existe ·
**[FEATURE]** funcionalidade nova · **[OPS]** correção operacional nossa.

Cada item tem uma seção **📎 Conteúdo do cliente** para receber os textos e
mídias que o Victor enviou sobre aquele ponto (preencher na sequência).

Contexto da clínica: em shadow mode, `autoReplyEnabled=false`, reengajamento
automático pausado (preset conservador — número com histórico de castigo).
Religar só após fechar os P0 daqui + post-mortem com o Victor.

---

## Visão geral

| # | Item | Tipo | Esforço | Prioridade |
|---|------|------|---------|-----------|
| 1 | Mais objetivo, fechar agendamento como o operador | PRODUTO | M | **P0** |
| 2 | R$30 explicado como reserva do horário | COPY | XS | **P0** |
| 3 | Fluxo foto do sorriso → doutor avalia → IA reassume | FEATURE | G | **P0** |
| 4 | Notificação WhatsApp para número pessoal do doutor | FEATURE | M | **P0** (base do 3, 8 e 13) |
| 5 | Trocar mídias pelas 2 fotos com valores | CONFIG | XS | **P0** |
| 6 | Google Calendar | CONFIG | S | P1 |
| 7 | Quantidades ≠ 10/20 escalonam para o doutor | COBERTO | — | — |
| 8 | Resumo diário 21h dos agendamentos p/ doutor | PRODUTO | S | P1 |
| 9 | Lembrete 24h antes + confirmação do paciente | COBERTO (validar) | S | P1 |
| 10 | Revisar notificação confirmar/no-show | COBERTO (validar) | S | P1 |
| 11 | Formas de pagamento | CONFIG | XS | P1 |
| 12 | Cores BL1/BL2/BL3 com imagem | CONFIG | XS | P1 |
| 13 | Cuidados pós-procedimento (1h) + feedback (24h) | FEATURE | M | P2 |
| 14 | Follow-up 7 dias (promo) e 14 dias (resgate) | FEATURE | M | P2 |
| 15 | Plástica gengival | CONFIG | XS | P2 |
| 16 | Clareamento consultório + caseiro (3+3 sessões) | CONFIG | XS | P2 |
| 17 | Procedimento não cadastrado → needs human | COBERTO | — | — |
| 18 | Pular linhas / formatação das mensagens | COBERTO (auditar) | S | P2 |
| OPS-1 | Cron staff roda 18h local (UTC), não 21h | OPS | XS | junto do 8 |
| OPS-2 | `resume-expired-takeovers` sem agendamento | OPS | XS | junto do 3 |

---

## Funil e fechamento

### 1. [PRODUTO] Mais objetivo, sem muita explicação — direcionar para o funil e fechar como o operador — **P0**

**Pedido:** respostas mais curtas; responder as perguntas iniciais → encaminhar
para a agenda → receber o sinal → efetivar no calendário. Fechar agendamento
como a Gleice faz hoje.

**Hoje:** o composer já limita a 2 parágrafos e tem instrução de "fechamento
confiante" (`ResponseComposer.ts:462`), mas a IA **pergunta** "posso ver os
horários?" em vez de **já ofertar o slot** — `fetchAndOfferSlots` só dispara
quando o lead pede. É o P0 da auditoria de 15/07 ("funil nunca dispara").

**Fazer:** após responder dúvida de preço/tratamento com sinal de interesse,
ofertar slots reais direto (orchestrator) + instrução de objetividade no
playbook v4. O funil sinal→efetivação (item 2) já existe e engata sozinho
depois da oferta.

**📎 Conteúdo do cliente:** ✅ APLICADO 17/07 — bloco OBJETIVIDADE nas notes do
playbook v4 ("responda em blocos curtos e conduza ativamente para o agendamento").
A oferta direta de slot no orchestrator segue pendente (código).

---

### 2. [COPY] R$30 explicado como **reserva do horário** — **P0**

**Pedido:** alterar a explicação dos R$30 dizendo que é sobre a reserva do horário.

**Hoje:** `DepositTemplates.ts:54` diz "Para CONFIRMAR o agendamento, pedimos um
sinal de R$ 30 via Pix". A reserva é mencionada antes ("deixei o horário
reservado provisoriamente"), mas o sinal não é apresentado como taxa de reserva.

**Fazer:** ajustar `buildDepositRequestMessage` para ancorar o valor na reserva
do horário. Confirmar com o Victor a frase exata (ex.: "para reservar seu
horário, pedimos R$30 via Pix" — e se o valor é abatido do procedimento, dizer).
Template é determinístico → mudança de código, 1-2 linhas + teste.

**📎 Conteúdo do cliente:** ✅ RESOLVIDO 17/07 — copy genérica alterada na branch
`feat/deposit-copy-reserva-horario` ("Para garantir a reserva do seu horário,
pedimos um sinal de R$ 30 via Pix"); abatimento já estava no depositNotes da
Vitalli ("O valor do sinal é integralmente abatido do procedimento no dia.").
Só a Vitalli tem deposit_enabled=true — sem risco para outras clínicas.

---

### 3. [FEATURE] Fluxo foto do sorriso → avaliação do doutor → IA reassume — **P0** (maior peça da reunião)

**Pedido (fluxo alvo completo):**
1. Saudação → dúvidas → valores (com fotos) → "tem mais alguma dúvida?"
2. Pede foto do paciente de forma educada e calorosa **+ envia imagem
   demonstrando o ângulo** da foto
3. Recebeu a foto → **pausa a IA** e levanta para avaliação humana, garantindo
   notificação no **número principal do doutor**
4. Doutor responde manualmente com valores e viabilidade
5. IA reassume (doutor reativa manualmente OU detectamos o fim da troca de
   mensagens dele) → conduz agendamento mediante os R$30
6. Efetiva, manda o endereço e encerra a conversa

**Hoje (blocos que já existem):**
- Pipeline por tratamento com step `photo` (`treatment.ts:52-59`) — mas o gate
  "foto obrigatória antes de agendar" está marcado v2, não implementado
- Acuse de foto recebida (`pipeline_photo_received` no composer)
- Pausa da IA: `aiPaused` + `takeoverExpiresAt` (TTL `takeoverTtlHours`, default 4h)
- Detecção do doutor respondendo do celular via `fromMe` no webhook Z-API
  (`zapi/route.ts:214-247`) — cada mensagem dele renova a pausa
- Retomada: quando o lead manda mensagem após TTL expirado, orchestrator
  despausa inline (`ConversationOrchestrator.ts:2246-2251`)
- Endereço na confirmação: já sai no `buildDepositConfirmationMessage`

**Falta construir:**
- (a) step `photo` interceptando o inbound (gate `required`)
- (b) envio da imagem de demonstração do ângulo junto do pedido de foto
- (c) pausa automática **ao receber a foto** + notificação ao doutor (depende do item 4)
- (d) retomada assistida: botão "devolver para a IA" no inbox já cobre o caso
  manual; retomada por contexto pode ficar para v2 — o TTL já cobre o fallback

**📎 Conteúdo do cliente:** ✅ PARCIAL 17/07 — imagem de exemplo do ângulo
("Exemplo Foto Avaliação (frontal e perfil)", asset 360c1034) + texto do pedido
("Você poderia nos encaminhar uma foto ou vídeo do seu sorriso para realizar uma
pré avaliação...") aplicados nos pipelines de Lentes, Remoção e Substituição
(step "content" com a imagem ANTES do photo step). Pausa automática + notificação
ao doutor seguem pendentes (feature, itens 3c/4).

---

### 4. [FEATURE] Notificações WhatsApp para o número pessoal do doutor — **P0** (habilitador dos itens 3, 8 e 13)

**Pedido:** notificação no número principal do doutor quando a IA escala (item 3)
e resumo diário dos agendamentos (item 8).

**Hoje (CORRIGIDO 17/07 — diagnóstico anterior estava errado):** o canal JÁ
EXISTE: `organizations.receptionist_phone` ("Telefone da recepção", aba Agenda
das configurações) recebe WhatsApp direto pela instância Z-API em 3 eventos:
(1) lead enviou mídia para avaliação — encaminha contexto + a própria mídia e
PAUSA a IA (`ConversationOrchestrator.ts:2037-2056`); (2) comprovante de sinal
recebido — encaminha o comprovante (`:1933-1943`); (3) needs-attention — "⚠️
{lead} precisa de você" (`notifyAttentionNeeded`, `:4546`). Número confirmado
para o Victor: +55 11 98924-3111.

**Fazer (o que sobra de verdade):**
- ✅ Corrigir copy enganosa: a notificação de mídia prometia "sua resposta será encaminhada
  automaticamente ao lead", mas NÃO existe relay — a resposta do doutor no chat
  da notificação não chega ao lead (o filtro `InternalWhatsAppOperationalMessage`
  só ignora o eco). O caminho real é o doutor responder pelo WhatsApp da clínica
  no chat do lead (takeover via fromMe). Decisão em 17/07: corrigir somente a
  copy e deixar relay para uma feature futura.
- Digest diário 21h via WhatsApp (item 8) pode reusar `receptionist_phone`.
- Esses envios são diretos (sendTextMessage), fora da outbox — avaliar migração
  junto do Channel Safety Fase 0.

**📎 Conteúdo do cliente:** telefone do Victor: +55 11 98924-3111.

---

## Config da clínica (sem código)

### 5. [CONFIG] Trocar as mídias pelas 2 fotos com valores e explicação — **P0**

**Pedido:** substituir as mídias atuais pelas duas fotos com valores e explicação
(ele já enviou os arquivos).

**Hoje:** biblioteca `media_assets` clinic-level + curadoria por playbook
(`mediaAssetIds`). Troca é upload + atualizar a seleção do playbook ativo.

**Atenção:** preço em imagem tem que bater com o estruturado
(`quantityPrices`: simpl 10=1.500/20=1.800 · estrat 10=1.800/20=2.000) — mesma
classe do incidente do card "Cuidados Pós Facetas" (R$350 vs R$400). Conferir
os valores nas fotos ANTES de ativar.

**📎 Conteúdo do cliente:** ✅ APLICADO 17/07 — as 2 fotos trouxeram a tabela
NORMAL (Premium 10=1.700/20=2.000 · Estratificada 10=2.000/20=2.500): dono
confirmou fim da promo → quantityPrices atualizados + rename "Técnica
Simplificada"→"Lente em Resina Premium" / "Técnica Estratificada"→"Lente em
Resina Estratificada" (nomes antigos viraram aliases) + cards na apresentação do
pipeline (assets 3348e716 / 61b3a144) + playbook v4 ativado sem "promocionais".
Objeção de preço antigo (v3) mantida — cobre leads que receberam a promo.

---

### 6. [CONFIG] Google Calendar — P1

**Pedido:** integrar com o Google Calendar.

**Hoje:** integração completa já existe (gateway com criar/cancelar evento,
webhook push, renovação semanal de canal — `resolve-calendar-gateway.ts`).
Vitalli está em `calendarMode=internal`.

**Fazer:** compartilhar a agenda dele com a service account, setar
`googleCalendarId` + `calendarMode='google_calendar'`. Decidir com ele: agenda
dedicada da clínica ou a pessoal? Validar com um agendamento de teste antes de
religar a IA. Ver também `IMPORTACAO-GOOGLE-CALENDAR.md` nesta pasta.

**📎 Conteúdo do cliente:** _aguardando (e-mail da conta Google / agenda)_

---

### 11. [CONFIG] Formas de pagamento — P1

**Pedido:** cadastrar as formas de pagamento (ele mandou por mensagem no WhatsApp).

**Fazer:** adicionar à `commercialPolicy` do playbook (via painel, nova versão).
Lembrar: o gate de ativação bloqueia preços em R$ na política — formas de
pagamento sem valores passam; se vier com valores (parcelamento com juros etc.),
estruturar no treatment.

**📎 Conteúdo do cliente:** ✅ APLICADO 17/07 — "À vista: Pix, débito ou crédito;
Pix 5% de desconto; até 21x no cartão (consultar taxas); NÃO trabalhamos com
boleto" na commercialPolicy do playbook v4 (substituiu o antigo "3x sem juros").

---

### 12. [CONFIG] Dúvidas sobre cores — BL1, BL2, BL3 (imagem) — P1

**Pedido:** responder dúvidas sobre cores das lentes com a imagem no WhatsApp.

**Fazer:** upload da imagem das cores na biblioteca (vinculada ao treatment de
lentes) + habilitar no playbook + instrução curta na política/playbook sobre
quando enviar ("lead perguntou de cor/tom → enviar imagem BL1-BL3 e explicar").

**📎 Conteúdo do cliente:** ✅ APLICADO 17/07 — imagem "Cores BL1, BL2 e BL3"
(asset 5d383eb4, GERAL) + guia nas notes ("se perguntar de cor/tom, envie a
imagem e explique que cor e formato são escolhidos junto com o Doutor") +
instrução no step de Q&A do pipeline de lentes.

---

### 15. [CONFIG] Plástica gengival — P2

**Pedido:** (item citado sem detalhe na reunião — confirmar se é cadastrar como
tratamento ofertável, com preço, ou só reconhecer a pergunta e escalar).

**Fazer:** cadastrar treatment (nome, duração, preço se cotável em chat,
`requiresEvaluationFirst`?) ou deixar cair no needs_human do item 17 até o
Victor definir preço.

**📎 Conteúdo do cliente:** ✅ APLICADO 17/07 — treatment "Plástica Gengival"
criado (0fee44ba, NÃO cotável, avaliação primeiro) com a explicação do Victor
("dar simetria... correção na gengiva... totalmente indolor") + 3 fotos
(antes/depois com afastador + antes-e-depois sorriso) + menção na política.
Preço segue não cotável até o Victor definir.

---

### 16. [CONFIG] Clareamento consultório + caseiro — 3 sessões clínica + 3 em casa — P2

**Pedido:** cadastrar o protocolo correto: 3 sessões no consultório e 3 sessões
em casa. Valores estão em mensagem no WhatsApp do canal.

**Fazer:** atualizar o treatment de clareamento (descrição do protocolo 3+3,
preço, duração da sessão) + garantir que a IA descreve o protocolo certo.
BookingWindows se aplica? (perguntar — hoje só Técnicas/Lentes/Avaliação/Remoção
têm janela 9h/16h; a manutenção preventiva também está pendente dessa resposta).

**📎 Conteúdo do cliente:** ✅ RESOLVIDO 17/07 — descrições dos 3 protocolos
aplicadas (3 semanas, 2h/dia caseiro; 15min+dessensibilizante consultório;
combinado). Preços CONFIRMADOS pelo dono: caseiro R$600 / consultório R$1.200 /
os dois R$1.500 (como já estava no banco). Os valores 400/800/1.000 da mensagem
do WhatsApp do Victor estão DESATUALIZADOS — não usar.

---

## Lembretes e notificações

### 8. [PRODUTO] Resumo diário 21h dos próximos agendamentos para o doutor — P1

**Pedido:** todos os dias às 21:00, enviar para o número pessoal do doutor os
próximos agendamentos.

**Hoje:** `appointment-reminder-staff` já monta exatamente esse resumo (agenda
de amanhã, linha por paciente) **mas** envia por web push e roda `0 21 * * *`
**UTC = 18h de Brasília** (OPS-1).

**Fazer:** corrigir schedule para `0 0 * * *` (21h BRT) + rotear também para o
canal WhatsApp do doutor (item 4).

**📎 Conteúdo do cliente:** _aguardando (formato que ele quer receber?)_

---

### 9. [COBERTO — validar] Lembrete 24h antes com confirmação do paciente — P1

**Pedido:** lembrete 24h antes do procedimento para cada lead confirmado +
validar o fluxo de confirmação.

**Hoje:** cron diário (13h UTC = 10h BRT) pega consultas 20-32h à frente, envia
lembrete pedindo confirmação (`appointment_reminder_with_confirmation`), estado
`awaiting_appointment_confirmation`; "sim" → `confirmed`, "não" → cancela +
pausa IA + needs attention. Categoria `reminder` é isenta de opt-out/quiet hours.
12 testes verdes em `AppointmentReminder.test.ts` + 30 em
`AppointmentConfirmationSignal.test.ts`.

**Fazer:** nada de código a priori — validar ponta a ponta no simulador e com
agendamento real de teste antes do go-live (nunca rodou ao vivo para a Vitalli).

**📎 Conteúdo do cliente:** _aguardando (texto de lembrete que usam hoje, se houver)_

---

### 10. [COBERTO — validar] Notificação para o doutor confirmar atendimento ou no-show — P1

**Pedido:** revisar a notificação que cobra do doutor marcar atendimento
realizado ou no-show.

**Hoje:** camada 2 do mesmo cron staff: lista atendimentos do dia que terminaram
e seguem `scheduled/confirmed` ("pendente de confirmação"), via web push, com
link para a agenda. Marcar `completed` é o gatilho do pós-procedimento (item 13)
— essa cobrança vira peça crítica do fluxo.

**Fazer:** revisar copy/horário junto do item 8 e rotear para WhatsApp (item 4).

**📎 Conteúdo do cliente:** _aguardando_

---

## Pós-procedimento e follow-up

### 13. [FEATURE] Cuidados pós (1h) + coleta de feedback (24h) — P2

**Pedido:** 1h após o procedimento, mensagem de cuidados + 2 imagens + 1 vídeo
para todos que fizeram lentes; 24h depois, colher feedback do paciente. A
clínica precisa confirmar a execução do procedimento (gatilho).

**Hoje:** nada existe. Blocos prontos: status `completed` no appointment,
sistema `follow_ups` (dispatcher com claim-before-send), outbox, biblioteca de
mídia. O trigger `appointment_completed` atual agenda só "retorno de rotina" em
+6 meses.

**Fazer:** dois triggers novos a partir do `completed`: `aftercare` (+1h, msg +
mídias por treatment) e `feedback_request` (+24h). Parametrizar por treatment
(lentes ≠ limpeza). Depende operacionalmente do item 10.

**📎 Conteúdo do cliente:** ✅ RECEBIDO 17/07 (feature pendente) — texto de
feedback ("Passando para saber como foi seu atendimento... lentes em resina"),
card de cuidados R$400 (asset 7e620435, JÁ na biblioteca — corrige o card R$350
desativado), guia completo (item-13-cuidados-pos-2-texto.jpeg) e vídeo
(item-13-video-cuidados.mp4) aguardando a feature de pós-procedimento para envio
automatizado. Arquivos em conteudo-victor-17-07/.

---

### 14. [FEATURE] Follow-up comercial: 7 dias (oferta promo) e 14 dias (resgate com mídia) — P2

**Pedido:** lead que não confirmou agendamento: 7 dias após a última mensagem →
follow-up com oferta promocional; 14 dias → perguntar se ainda tem interesse,
com a mídia mais atrativa + valor de resgate de lead.

**Hoje:** não existe essa régua. `recovery-campaign` recupera lead esquecido
(>2h sem resposta) — outra coisa; `markStaleLeads` marca lost aos 14 dias com
follow-up +30d — não casa. **E o reengajamento automático está pausado na
Vitalli** (preset conservador do número castigado).

**Fazer:** régua de nurture nova (trigger: X dias sem `appointment` ativo desde
a última troca) com template/oferta configuráveis. **Decidir com o Victor**: essa
régua fura o preset conservador ou espera o número esquentar? Caps do Channel
Safety valem integralmente aqui (categoria `follow_up`, gated).

**📎 Conteúdo do cliente:** _aguardando (oferta promocional dos 7 dias, mídia +
valor de resgate dos 14 dias)_ — atenção: a promo geral ACABOU (item 5); a oferta
de resgate precisa ser definida pelo Victor à parte.

---

## Cobertos — comportamento confirmado no código

### 7. [COBERTO] Quantidades ≠ 10/20 → escalona para o doutor

Victor pediu para **manter o envio ao doutor** avaliar e responder manualmente.
É exatamente o comportamento atual: `resolveQuantityPriceQuery` cota apenas
quantidades da tabela; fora dela responde "confirmo com a equipe" sem chutar
(`quantity-price.ts:72`, testes verdes). **Fecha a pendência das quantidades
ad-hoc (9/16/só-superior): não cadastrar.**

### 17. [COBERTO] Procedimento não cadastrado / preço desconhecido → needs human

"Como já está hoje" — confirmado: manutenção não catalogada, garantia e casos
atípicos viram `needs_human` com `attentionReason` e gap logado
(`ConversationOrchestrator.ts:2740-2798`).

### 18. [COBERTO — auditar] Pular linhas / escrever da melhor forma

O composer já exige blocos de 1-2 frases com linha em branco entre assunto,
condição e próximo passo, e item por linha em listas (`ResponseComposer.ts:478-480`).
Se as respostas do shadow estão saindo em bloco único, coletar exemplos reais e
tratar como bug de prompt — não criar regra nova às cegas.

---

## OPS — achados nossos no caminho

- **OPS-1:** crons do `vercel.json` são UTC. `appointment-reminder-staff` roda
  18h local (não 21h). Corrigir junto do item 8 e revisar os demais horários
  prometidos em hora local.
- **OPS-2:** `/api/cron/resume-expired-takeovers` existe mas **não está no
  `vercel.json`** — nunca roda. Mitigado pela retomada inline no orchestrator
  quando o lead manda mensagem, mas agendar (ou remover a rota) junto do item 3,
  que vai depender de takeover bem comportado.

---

## Sequência sugerida

1. **Agora (pré-religar):** 2 (copy R$30) → 5 (fotos valores) → 11/12 (config) →
   OPS-1/OPS-2 → 1 (oferta direta de slot) → validação 9/10 no simulador
2. **Bloco do doutor:** 4 (canal WhatsApp staff) → 3 (fluxo foto) → 8/10 no
   canal novo
3. **Pós-religar:** 13 (pós-procedimento) → 14 (régua 7/14 — decidir com Victor
   sobre o preset conservador) → 6 (Google Calendar pode entrar antes se ele
   fizer questão)

Pendências para perguntar ao Victor: frase exata do R$30 (abate do total?),
janela da manutenção preventiva (9h/16h?), clareamento tem janela?, plástica
gengival (preço/oferta?), qual agenda Google usar, e se a régua 7/14 dias pode
rodar com o número ainda em preset conservador.
