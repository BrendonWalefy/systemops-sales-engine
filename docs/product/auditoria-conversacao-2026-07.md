# Auditoria de Conversação — Julho/2026

**Base de evidência**: 62 leads reais da Ximendes (1.283 mensagens, export de 02/07/2026), código de `src/core/intelligence/`, `src/core/pipeline/`, follow-ups e ferramentas do operador.

**Contexto do funil hoje**: 31 de 62 leads = `lost` (50%), 15 em `waiting_response`, 4 agendados. Só 1 conversa marcou `needs_attention` em toda a base — a IA quase nunca aciona a equipe, mesmo em momentos de venda.

**Objetivo**: excelente experiência para o lead + alimentar as ferramentas do operador (insights, sugestões de fechamento, respostas).

---

## Parte 1 — Padrões de falha encontrados nas conversas reais

### F1. Saudação-concierge engole a pergunta do lead (frequência alta, perde venda)

A mensagem "Boa tarde... me conta o que você gostaria de ver hoje: valores, agendamento ou algum serviço específico?" é enviada mesmo quando o lead **já disse o que quer**:

- **Tania** (23/06): *"Olá! Posso ter mais informações sobre custo?"* → recebeu a saudação genérica perguntando se quer ver "valores".
- **Julllys** (15/06): *"E qual seria os valores?"* → saudação genérica; preço nunca veio da IA. Lead `lost`.
- **Carla** (23/06, áudio): *"estou aqui na frente mas ninguém atende"* → saudação genérica "valores, agendamento...". Paciente na porta da clínica.
- **Rogger** (29/06, áudio com dúvida clínica) → mesma saudação genérica.
- **Jean** (02/07): "Boa noite" + pergunta de preço → saudação genérica primeiro, resposta depois.

Causa: interceptores de greeting/acknowledgment e o classificador aceitam `greeting`/`acknowledgment` para mensagens que contêm pergunta de negócio. O starter concierge não considera o conteúdo pendente da rajada.

### F2. Rajadas de mensagens geram respostas em série, redundantes ou contraditórias

Cada mensagem da rajada é respondida isoladamente:

- **Aylane** (01/07): escolheu "As 12hs" + "Sexta feira" em 2 mensagens → recebeu **duas respostas contraditórias**: "horário não está mais disponível" (falso) reoferecendo a MESMA lista com o horário "indisponível" dentro.
- **Hellen** (26/06): foto + pergunta de preço → 2 handlers responderam (preço de lentes + "recebi sua foto"), e ainda 2 mídias depois.
- **Tarcisio** (30/06): disse *"Não é lentes"* e os **vídeos de lentes chegaram depois da negação** (fila de outbound não é cancelada quando o contexto muda). Além de 3 pares de resposta duplicada.
- **Eric, Nilza, Fe Em Deus, Larissa**: respostas duplicadas quase idênticas em sequência (menus 2x, general_question 2x).

### F3. Fixação no pipeline de lentes / ancoragem de preço errada

- **Hellen** (26/06): pediu preço de *"contorno nos 4 dentes da frente"* → IA cotou **lentes 20 elementos (R$2.500–5.000)**. O operador corrigiu: recontorno é **R$250/dente**. A IA ancorou a lead num preço 10x maior.
- **Tarcisio** (30/06): negou lentes 2x e pediu prótese/dentadura → IA voltou a explicar lentes 3x, misturou os dois assuntos.
- **Jean** (02/07): polimento → cotou lentes novas. *(corrigido em 03/07 com guards determinísticos — `detectUncataloguedMaintenanceInquiry` e `detectAmbiguousTreatmentTerm` em `ConversationOrchestrator.ts` + testes em `TreatmentGuards.test.ts`)*

### F4. Follow-up/reengagement às 02:43 da manhã e com template genérico

- Pelo menos **8 leads** receberam reengagement às **02:43** (ex.: vídeo enviado ~20:43 + 6h). `calculateFollowUpDueAt` (`schedule-follow-up.ts`) soma horas cruas; o dispatcher (`follow-up-dispatcher/route.ts`) **não tem quiet hours nem timezone da clínica**.
- Template repetido para todos ("Conseguiu dar uma olhada no vídeo?"), às vezes errado (Diva recebeu "vídeo sobre a técnica simplificada" quando perguntou de valores).
- Reengagement dispara mesmo quando o operador está conduzindo a conversa (Flavia, Cida, Pedro).

### F5. A IA não sabe o que o operador vende (gap de conteúdo comercial)

Comparando respostas do operador com a política cadastrada, a IA **não tem**:

| O que o operador cota | Onde apareceu |
|---|---|
| 10 lentes: R$1.500 (simpl.) / R$2.500 (estrat.) | Rayane, Flavia, Sabrina, "." |
| Parcelamento real: até 21x com taxa, **3x sem juros** | Karen, Mirelly |
| Manutenção: 6/6 meses, **R$500** | Mirelly (e Jean/Francielly perguntaram!) |
| Recontorno estético: **R$250/dente** | Hellen |
| Sinal de agendamento: **R$30** para leads de anúncio | Rayane |
| Promoções com validade ("R$500 off até 26/06") | broadcast manual do operador |

A política diz "12x" e só preços de 20 elementos. Toda pergunta fora disso vira resposta vaga ou handoff. **Perguntas de manutenção e proporção (13 elementos, só arcada de cima) são recorrentes.**

### F6. Momentos de venda sem alerta para a equipe

- **Tania** (07/06): objeção de preço concreta (*"minha amiga pagou 1.800 nas 20"*) + já seguia o Instagram → ninguém foi notificado; 17 dias no vácuo; `lost`.
- **Studio Zed** (29/05): propôs **permuta** (tattoo por lentes) → 4 respostas genéricas "estou aqui se precisar 😊". (Regra de permuta existe hoje no prompt, mas sem guard determinístico.)
- 15 leads em `waiting_response`, vários `warm/hot`, sem cadência de follow-up além do template único.

### F7. Agendamento — atritos específicos

- **Emerson** (22/06): IA agendou "retorno" para 03/07; o protocolo real era retorno em setembro. Operador teve que cancelar. A IA **não valida protocolo de retorno pós-procedimento** — retorno de paciente deveria consultar a equipe.
- **Aylane**: caso do slot "indisponível" reoferecido (ver F2).
- **Carla**: pediu "horário amanhã" com avaliação já discutida → IA perguntou "qual procedimento?" (fricção).

### F8. patient_arrived não dispara com áudio/frases reais

- **Carla** (áudio): *"estou aqui na frente mas ninguém atende"* → `acknowledgment` + saudação genérica. A regra de prioridade existe no prompt do classificador, mas o gpt-4o-mini falhou. Sem guard determinístico e sem notificação à equipe.

### F9. Entrega de mídia e formatação quebradas

- **Cassia/Diva/Luis**: texto com buracos onde estavam os tokens — *"posso te mostrar alguns vídeos: e ."* — restos de conectivos órfãos após extração dos `[MEDIA:id]`.
- **bielbygod** (16/06): pediu "pode ser os vídeos" → intent `acknowledgment` → IA escreveu **"[VÍDEO] Lentes – Técnica Simplificada" como texto literal**; vídeos nunca enviados.
- **Markdown `**negrito**` indo cru para o WhatsApp** (renderiza asteriscos literais; WhatsApp usa `*negrito*`).
- **Dina** (04/06): selecionou item 8 da lista de procedimentos → *"Ops, tive um problema técnico"* (fluxo menu legado).

### F10. Ferramentas do operador subalimentadas

- **suggest-reply** (`api/conversations/[id]/suggest-reply`): prompt recebe só nome + interesse + últimas 12 mensagens. **Sem política comercial, sem catálogo/preços, sem parcelamento, sem attention_reason** → sugestões não conseguem fechar venda com dados corretos.
- **Insights**: `treatment-gaps` e `operational-insights` existem, mas não capturam: objeções de preço, leads waiting_response envelhecendo, pedidos não atendidos, permutas/negociações detectadas.

---

## Parte 2 — Plano de correção priorizado

### P0 — Perde venda hoje (fazer primeiro)

1. **Guard anti-saudação-genérica** — se a mensagem (ou a rajada pendente) contém pergunta de negócio (`isPriceRequestText`, menção a tratamento, agendamento), NUNCA responder com starter concierge/acknowledgment; responder a pergunta. Determinístico, no Orchestrator. *(F1)*
2. **Quiet hours para follow-ups** — clamp de `dueAt` para a janela útil da clínica (ex.: 9h–20h, `ClinicTimezone`); dispatcher pula fora da janela e reagenda. Suprimir reengagement quando operador ativo na conversa (última msg `clinic_user` < N horas). *(F4)*
3. **Resposta única por rajada** — consolidar mensagens do debounce em UMA classificação+resposta; cancelar outbound pendente quando o lead nega/muda de assunto antes da entrega. *(F2, Tarcisio/Aylane/Hellen)*
4. **Onboarding de conteúdo comercial da Ximendes** — cadastrar preços por 10 elementos, 3x sem juros/21x, manutenção R$500, recontorno R$250/dente, sinal R$30; criar campo/feature de **promoção com validade** para a IA saber das campanhas. *(F5 — config + produto)*
5. **Bug do slot reoferecido como indisponível** — reproduzir caso Aylane (`confirm_slot` com texto em vez de número + slot ainda listado); revisar TTL de reserva e mensagem de indisponibilidade. *(F7)*

### P1 — Experiência do lead

6. **Guard determinístico de negação** — "não é X" → suprimir X do contexto e da fila de mídia (o prompt sozinho falhou). *(F3)*
7. **patient_arrived determinístico** — keywords ("cheguei", "estou aqui", "na frente", "na porta") + agendamento hoje → confirmar chegada + **notificar equipe**. *(F8)*
8. **Retorno de paciente ≠ novo agendamento** — lead com procedimento realizado pedindo "retorno" → needs_human ou validação de protocolo antes de agendar. *(F7, Emerson)*
9. **Higiene de mídia** — pós-processar parts para remover conectivos órfãos ("e", ".", "-" sozinhos); garantir envio real de mídia quando o lead pede vídeos em qualquer intent; convertor `**` → `*` no outbound WhatsApp. *(F9)*
10. **Estender guard de ambiguidade** para `general_question` (hoje só `price_inquiry`); `resolveInformationalTreatmentTarget` escolhe uma variação arbitrariamente (pipeline-first). *(F3)*
11. **Preço de serviço não catalogado** (contorno, ajuste estético pontual) → não ancorar no preço de lentes; tratar como gap + handoff (padrão do guard de manutenção). *(F3, Hellen)*

### P2 — Ferramentas do operador / insights

12. **suggest-reply com contexto completo** — injetar política comercial, catálogo com preços, parcelamento, temperatura, attention_reason e último contexto da IA. É a "sugestão de fechamento" de verdade.
13. **Radar de fechamento no Inbox** — insights novos: objeção de preço detectada, lead hot/warm em waiting_response > 24h (15 hoje!), pedido de humano não atendido, proposta de permuta/negociação.
14. **Reengagement contextual** — mensagem gerada com o histórico real (última dúvida do lead), não template; máximo N tentativas; cadência por temperatura.
15. **Métricas de funil no MetricsAggregator** — % primeira resposta útil (vs saudação genérica), taxa de lost sem resposta de preço, tempo até primeira resposta da equipe pós-handoff.

### P3 — Robustez

16. **Classificador**: gpt-4o-mini é a raiz de vários misses (F1, F3, F8). Caminho preferido do produto: mais guards determinísticos (padrão já estabelecido). Avaliar em paralelo upgrade de modelo com benchmark nas transcrições reais.
17. **Harness de replay** — transformar transcrições reais em testes de regressão (mensagens do lead → intents/ações esperadas), começando pelos casos deste documento.
18. **Menu legado** — corrigir crash de seleção (Dina, item 8) ou aposentar `menu_first`.

---

## Já corrigido em 03/07/2026

- Guard de manutenção não catalogada (polimento/retoque/reparo/troca) → needs_human + treatment gap + equipe notificada.
- Guard de ambiguidade entre variações (lentes simplificada × estratificada) em price_inquiry.
- Prompts reforçados (classificador + composer). PR #104, em produção.
