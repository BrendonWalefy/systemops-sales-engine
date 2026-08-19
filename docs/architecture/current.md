# Arquitetura atual

Atualizado em 2026-08-17. Este documento descreve o runtime em produção; planos antigos não são fonte de verdade.

## Resumo

O SystemOps é um **monólito modular multi-tenant** em Next.js, implantado na Vercel, com PostgreSQL/Neon como sistema de registro. Mensagens e automações usam um pipeline assíncrono durável implementado com inbox, jobs e outbox no próprio PostgreSQL.

Não há microsserviços, Kafka, SQS, SNS ou RabbitMQ hoje. Essa é uma decisão proporcional ao estágio: as fronteiras existem no código, enquanto operação, deploy e consistência permanecem simples.

Princípio central:

> O LLM entende e verbaliza. O sistema decide.

- `IntentClassifier` devolve classificação estruturada.
- `ConversationOrchestrator` valida invariantes e executa ações reais.
- `ResponseComposer` transforma resultados permitidos em linguagem humana.
- Booking, tenant, autorização, handoff, estado, retry e safety gates são determinísticos.

## Topologia

```text
Usuários / PWA                         Serviços externos
Owner + equipe                        OpenAI / Anthropic / TTS
      |                               Google Calendar / Resend / Sentry
      v                                      ^
Next.js 16 na Vercel                        | ports / adapters
  UI + Server Actions + Route Handlers + Vercel Cron
      |
      +--> Conversation / Scheduling / Campaign / Operations Core
      |
      +--> Drizzle --> Neon PostgreSQL
                     dados + config + inbox + jobs + outbox + métricas

Lead <--> WhatsApp <--> Z-API principal / Meta Cloud API compatível
```

### Camadas

| Camada | Pasta | Responsabilidade |
| --- | --- | --- |
| Domain | `src/domain/` | Entidades, value objects e contratos de repositório |
| Application | `src/application/` | Use cases, ports, jobs e serviços de aplicação |
| Core | `src/core/` | Conversa, agenda, state machine e inteligência |
| Infrastructure | `src/infrastructure/` | PostgreSQL, canais, calendário, IA, TTS, storage, push e Sentry |
| App | `src/app/` | UI, server actions, route handlers e crons HTTP |

Route handlers autenticam, resolvem contexto, validam entrada e delegam. Regras de negócio não devem morar nas rotas ou nos componentes de UI.

## Fluxo de uma mensagem

```text
WhatsApp
  -> POST /api/whatsapp/zapi
  -> autenticação + resolveClinicByZapiInstance()
  -> recordInboundEventAndEnqueue()
     -> grava inbound_events e jobs(message.process) atomicamente

GET /api/cron/message-worker
  -> claim com lease e exclusão por conversa
  -> ProcessMessageJobHandler
  -> normalização, policy e transcrição opcional
  -> ConversationOrchestrator.handle()
     -> mensagem + state machine + contexto
     -> IntentClassifier
     -> decisão determinística
     -> BookingService / pipeline / handoff / repositories
     -> ResponseComposer
     -> enqueueOutboundMessage()
        -> grava outbound_messages e jobs(message.send) atomicamente

GET /api/cron/sender-worker
  -> claim ordenado
  -> SendMessageJobHandler
  -> safety gate + TTS/mídia quando necessário
  -> ChannelAdapter
  -> WhatsApp
```

### Garantias do pipeline

- A entrada e seu job são criados por um único statement SQL com CTE.
- A saída e seu job também são criados atomicamente.
- Unique constraints e dedupe keys tornam retries seguros.
- `FOR UPDATE SKIP LOCKED`, leases e exclusão por conversa evitam processamento concorrente incompatível.
- A outbox preserva conteúdo e ordem; retry de entrega não recomputa a conversa.
- Jobs excedidos viram `dead`; o owner pode reprocessar ou descartar com motivo e auditoria.
- A reconciliação de órfãos permanece como defesa para registros legados e caminhos de fallback.

### Correlação e privacidade

Um `turnId` derivado do `inboundEventId` acompanha processamento, outbox e entrega. O Decision Trace persiste apenas metadados permitidos por 30 dias: não guarda corpo, prompt, resposta, telefone, nome ou URL.

Detalhes em [Replay e Decision Trace](replay-and-decision-trace.md).

## Modos de automação

| Modo | Comportamento |
| --- | --- |
| `live` | organização ativa e auto-reply ligado; o motor pode decidir, persistir estado e enviar |
| `observe` | registra inbound e atividade humana, mas não altera funil, agenda ou resposta da IA |
| `disabled` | automação conversacional desligada |

Replay isolado, e não shadow online, é a evidência para validar comportamento hipotético completo.

## Dados e fontes de verdade

| Categoria | Dono principal |
| --- | --- |
| Tenant e configuração operacional | `organizations` |
| Capabilities e voz | `clinic_modules` |
| Conteúdo editorial ativo | `playbook_versions` |
| Catálogo e pipeline | `treatments` |
| Jornada | `leads`, `conversations`, `messages`, `conversation_states` |
| Inbox e fila | `inbound_events`, `jobs` |
| Entrega | `outbound_messages` |
| Agenda | `appointments`, `calendar_blocks`, `slot_reservations` |
| Campanhas | `price_campaigns`, `reactivation_campaigns`, `reactivation_campaign_targets` |
| Operação | métricas, custos, health snapshots, traces e dead-letter actions |

O schema usa `organizations`; identificadores e APIs internas ainda mantêm nomes como `clinicId` em vários pontos por compatibilidade. Isso não altera o isolamento por tenant.

## Multi-tenancy

O tenant é resolvido antes de qualquer acesso relevante:

- webhook: credencial/identificador do canal;
- UI e server actions: sessão e membership;
- owner: sessão privilegiada e organização explícita;
- crons: iteração explícita ou job já associado ao tenant.

Credenciais de canal ficam criptografadas no banco. Não existe fallback global de Z-API, Meta, calendário, playbook ou usuário de organização.

## Conversa e LLMs

Pontos principais de IA:

- `IntentClassifier`: intenção e entidades em JSON estruturado;
- `ResponseComposer`: resposta baseada no resultado concreto;
- `PlaybookAdvisor` e setup studies: análise editorial/operacional;
- Whisper: transcrição;
- gateways de TTS: síntese de voz.

Classifier e composer recebem a mesma janela recente de conversa. Conteúdo específico da organização vem do playbook ativo e do catálogo; comportamento universal fica no código de inteligência.

### Resposta autorizada e fallback seguro

Nos caminhos que compõem uma resposta a partir de uma ação, o resultado
determinístico é a fronteira entre decisão e linguagem:

```text
ActionResult
  -> AuthorizedResponsePlan
  -> ResponseComposer
  -> ResponseValidator
  -> resposta validada ou fallback determinístico/handoff
  -> outbound_messages + job message.send
```

`AuthorizedResponsePlan` deriva uma allowlist das fontes já resolvidas: preços
explícitos, labels de agenda, mídia permitida, estado esperado, limite de
caracteres e no máximo uma pergunta. O composer apenas verbaliza o
`ActionResult`; ele não autoriza fatos novos. Antes de a resposta planejada
entrar na outbox, o `ResponseValidator` bloqueia conteúdo vazio, tamanho ou
quantidade de perguntas excedidos, mídia não autorizada, preço ou fato de
agenda fora do plano e promessa sem suporte.

Erro do composer, resposta inválida ou caso que exige avaliação seguem pelo
`SafeResponseFallback`. Quando uma cópia determinística baseada no resultado
real também passa no validator, ela é enviada; quando não passa, o sistema usa
cópia neutra e solicita handoff com razão fixa, sem registrar texto do lead ou
do modelo no trace. Assim, fallback é uma saída segura para uma resposta
bloqueada, não uma aprovação da resposta bloqueada.

O Decision Trace registra somente metadados permitidos dos estágios
`response.plan_built`, `response.validated` e, quando aplicável,
`response.fallback_applied`; contagens e códigos substituem conteúdo,
prompts, preços, horários, mídia e identificadores externos. Uma falha de
observabilidade continua best-effort e não muda a decisão de negócio.

Esta é a primeira seam de extração do `ConversationOrchestrator`, não a sua
decomposição completa. A extração de montagem de resposta/mídia reduziu o
arquivo de 9.143 para 8.271 linhas, mantendo re-exports compatíveis. As
próximas seams, nesta ordem, são `HandoffPolicy`, `AgendaOfferService`,
`TreatmentJourneyService` e `ReservationAndDepositService`.

O código e seus testes não autorizam operação externa. Validação com dados
privados aprovados, banco de Lab e qualquer operação de cliente permanecem
gates separados descritos em [Replay e Decision Trace](replay-and-decision-trace.md).

### Conversation Intelligence V2: shadow fechado e ativação interna fail-closed

O selector tenant-scoped da V2 tem vocabulário fechado `v1 | v1_with_v2_shadow |
v2_internal` e default `v1`, separado do legado `shadowModeEnabled`. `observe` e `disabled`
têm precedência e não executam V2. Em produção, o único modo V2 hoje exercido é shadow
explicitamente configurado: ele roda depois do processamento e da tentativa awaited do sender V1, usa somente
snapshots imutáveis das leituras que a V1 realmente consumiu e transforma decisões de escrita em
`would_have_executed`, sem chamar a capability, outbox, calendário ou canal.

Quando uma leitura V1 não possui chave lossless no contrato V2 — atualmente a busca de
availability — o shadow retorna `shared_read_unavailable`; não reconstrói o snapshot. Como o seam
atual também não captura o artifact final enviado pela V1, live records marcam o braço V1
`unavailable` e a comparação `not_measurable`, sem inferir divergência de planos intermediários.

No braço V2, o Dental Pack é o dono da provenance capability → Decision → action concreta →
outcome → classe/requisitos. Uma única definição frozen sustenta tipos e validação runtime; a
application boundary pareia Decision preparada e ActionResult antes de persistir e conserva a
action concreta no shadow. Como o evaluator é uma porta não confiável, ActionResults são novamente
canonicalizados pelo schema registrado antes da redução ao summary; erro local de validação não é
contado como falha do sink e produz zero append. O `conversation-core` continua genérico e sem
literais dentais.

O deadline do lote é de admissão. Depois de T nenhuma operação começa; trabalho já admitido é
drenado e eventual overrun é medido. Isso não é uma garantia de retorno estrito até T.

O shell live V2 existe no código e reutiliza o lifecycle atual — dedupe, `conversation_states`,
`BookingService`, durable outbox e sender —, mas `v2_internal` continua fail-closed em V1. Ele só
é alcançável pelo SystemOps Lab interno, e apenas quando uma approval Ed25519 interna registrada
vincula build, tenant, canal e configuração, com `isTest=true`, `isDemo=false` e status `test`.
Qualquer ausência devolve o turno à V1 antes de qualquer efeito, e não existe fallback `V2 -> V1`
dentro do mesmo turno: trocar a flag vale a partir do turno seguinte.

#### Verbalização da V2

A V2 decide de forma determinística e só então escolhe palavras. O `AuthorizedResponsePlan` e o
validador de atos continuam sendo a fronteira do que pode ser dito; depois deles, um modelo
reescreve as intenções autorizadas em português natural, e um segundo validador — determinístico,
sobre o texto — decide se essa reescrita pode sair:

```text
ActionResult
  -> AuthorizedResponsePlan
  -> draft determinístico de atos + validador de atos
  -> superfície autorizada (valores, dinheiro, dígitos do assunto, perguntas, tamanho)
  -> verbalização por modelo, sob prazo do turno
  -> validador do texto
  -> texto do modelo ou texto determinístico do mesmo plano
  -> enqueueOutboundMessage
```

O verbalizador recebe apenas o que pode ser dito: as intenções autorizadas, os valores exatos de
cada uma, o estilo e o perfil de quem fala. Ele não recebe o plano completo, que carrega fato
interno e referência de evidência. A unidade de validação do texto é o valor inteiro, e não o
dígito: cada valor autorizado precisa aparecer completo e todo dígito fora desses trechos é
recusado, o que impede recombinar dois horários oferecidos em um terceiro que não existe. Também
são recusados dinheiro sem valor autorizado — inclusive por extenso —, link, promessa e pergunta
que nenhum ato pediu.

Uma recusa nunca é silêncio: sai o texto determinístico do mesmo plano. Falha ou demora do
provedor têm o mesmo destino, e o Decision Trace registra em `response.validated` qual identidade
escolheu as palavras entregues e, quando houve recusa, os códigos fechados que a motivaram.

O perfil de quem fala carrega maneira, não conteúdo: nome de apresentação, organização,
especialidade, tom de voz e a orientação editorial de condução, lidos dos donos declarados em
[fontes de verdade](sources-of-truth.md). Preço, diferencial, garantia e resposta a objeção não
viajam como prosa de prompt — eles chegam ao lead como fato autorizado por uma capability, ou não
chegam.

Hoje nenhum tenant ou canal foi ativado, e o gate report do Cycle I continua sem assinatura, com
zero observações V1×V2 e decisão `NO_GO`. Essa authority interna não altera esse resultado, não
substitui os dois reviewers humanos calibrados exigidos antes do primeiro cliente externo e não
alcança tenant externo. A evidência e os gaps estão em
[Ciclo I — shadow e comparação](../ai-system/cycle-i-shadow-comparison.md); o procedimento de
ativação interna está em [Runbook do SystemOps Lab](../operations/systemops-lab-runbook.md).

## Agenda

- `ClinicTimezone` é a única fonte para tempo local.
- `SlotEngine` calcula disponibilidade.
- `InternalCalendarGateway` usa appointments e blocks.
- `GoogleCalendarGateway` atende organizações opt-in.
- `SlotReservationService` protege contra double booking.
- `BookingService` coordena reserva, gateway e persistência.

Nenhum consumidor cria evento externo diretamente fora do `BookingService`.

## Home e funil

A Home é abastecida server-side por queries tenant-scoped sobre leads, conversas, mensagens, agendamentos, catálogo, ofertas e saúde do canal. Funil, comparações de período, receita e filas acionáveis são cálculos determinísticos.

```text
PostgreSQL -> fetchDashboardData(period) -> cálculos de domínio -> DashboardCommandCenter
```

O LLM não calcula KPI, funil, receita nem status operacional.

## Campanhas e automações

- `price_campaigns` define ofertas vigentes consumidas pela cotação, booking e Home.
- `reactivation_campaigns` congela audiência e targets, gera rascunhos, exige revisão/aprovação e dispara pela outbox.
- follow-up, recovery, lembretes, pós-atendimento e confirmação de sinal usam a mesma entrega durável destinada ao lead.
- notificações internas ao responsável ainda podem usar um caminho operacional separado, pois não pertencem a uma conversa falsa com o lead.

## Integrações

| Integração | Papel | Estado |
| --- | --- | --- |
| Z-API | WhatsApp principal por organização | produção |
| Meta Cloud API | webhook autenticado e adapter alternativo | compatível |
| Neon PostgreSQL | dados, configuração, fila e outbox | produção |
| OpenAI / Anthropic | LLMs, transcrição e parte do TTS | produção por caso de uso |
| Google Calendar | agenda externa por `calendarMode` | opt-in |
| Vercel Blob | mídia e áudio temporário | produção |
| Resend / Web Push | email, digest e notificações | produção |
| Sentry | erros e contexto sanitizado | produção |

## Limites atuais

1. PostgreSQL concentra OLTP e mensageria; é simples, mas aumenta contenção quando o volume crescer.
2. Workers acionados por cron têm granularidade e concorrência limitadas em relação a consumidores long-lived.
3. Alertas internos do responsável ainda não usam uma outbox operacional única.
4. O domínio de aplicação ainda preserva vocabulário clinic-centric em partes do código.
5. Não há event bus externo para fan-out entre consumidores independentes.

Esses limites possuem gatilhos mensuráveis e uma evolução incremental em [Arquitetura alvo](target-architecture.md).
