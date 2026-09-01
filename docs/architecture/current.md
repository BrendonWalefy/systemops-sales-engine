# Arquitetura atual

Atualizado em 2026-08-25. Este documento descreve o runtime do release V2-only; planos antigos não são fonte de verdade.

## Resumo

O SystemOps é um **monólito modular multi-tenant** em Next.js, implantado na Vercel, com PostgreSQL/Neon como sistema de registro. Mensagens e automações usam um pipeline assíncrono durável implementado com inbox, jobs e outbox no próprio PostgreSQL.

Não há microsserviços, Kafka, SQS, SNS ou RabbitMQ hoje. Essa é uma decisão proporcional ao estágio: as fronteiras existem no código, enquanto operação, deploy e consistência permanecem simples.

Princípio central:

> O LLM entende e verbaliza. O sistema decide.

- o Understanding V2 devolve demanda estruturada;
- capabilities e Decisions determinísticas executam ações reais;
- o verbalizador V2 transforma somente resultados autorizados em linguagem humana.
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
  -> após commit, solicita wake one-shot no run_at persistido

GET /api/cron/message-worker?ack=1 (evento) ou cron de fallback
  -> claim com lease e exclusão por conversa
  -> ProcessMessageJobHandler
  -> normalização, policy e transcrição opcional
  -> V2LiveConversationHandler.handle()
     -> lifecycle + state machine + contexto
     -> Understanding estruturado
     -> capabilities + decisão determinística
     -> BookingService / pipeline / handoff / repositories
     -> AuthorizedResponsePlan + verbalizador + validator
     -> enqueueOutboundMessage()
        -> grava outbound_messages e jobs(message.send) atomicamente
        -> após commit, solicita wake one-shot do sender

GET /api/cron/sender-worker?ack=1 (evento) ou cron de fallback
  -> claim ordenado
  -> SendMessageJobHandler
  -> safety gate + TTS/mídia quando necessário
  -> ChannelAdapter
  -> WhatsApp
```

### Garantias do pipeline

- A entrada, autoridade de stream e seu job são criados por uma transação HTTP não interativa: uma lista fixa e limitada de statements é enviada em um único `db.batch(...)` e confirma ou reverte em conjunto.
- A saída e seu job também são criados atomicamente.
- Unique constraints e dedupe keys tornam retries seguros.
- `FOR UPDATE SKIP LOCKED`, leases e exclusão por conversa evitam processamento concorrente incompatível.
- A outbox preserva conteúdo e ordem; retry de entrega não recomputa a conversa.
- Jobs excedidos viram `dead`; o owner pode reprocessar ou descartar com motivo e auditoria.
- A reconciliação de órfãos permanece como defesa para registros legados e caminhos de fallback.
- Wakes são one-shot, limitados e posteriores ao commit; falha no wake preserva o job e o cron de 10 minutos o recupera sem polling contínuo.

### Correlação e privacidade

Um `turnId` derivado do `inboundEventId` acompanha processamento, outbox e entrega. O Decision Trace persiste apenas metadados permitidos por 30 dias: não guarda corpo, prompt, resposta, telefone, nome ou URL.

Quando o contrato determinístico rejeita uma saída do modelo, a saída bruta pode ser guardada
separadamente como evidência criptografada, vinculada ao tenant, conversa, turno e estágio. A
listagem expõe somente metadados; revelar uma evidência individual exige sessão owner, escopo
exato do tenant, validade criptográfica e auditoria durável. O conteúdo bruto expira em 7 dias e
os metadados e acessos auditados expiram em 30 dias. Essa observabilidade não participa da
decisão, do fallback, da authority V2, da outbox ou da entrega.

Detalhes em [Replay e Decision Trace](replay-and-decision-trace.md).
Operação em [evidência de rejeição de contratos de IA](../operations/ai-contract-rejection-evidence.md).

## Modos de automação

| Modo | Comportamento |
| --- | --- |
| `live` | organização ativa, permissão tenant-scoped e auto-reply ligados; o runtime V2 pode decidir, persistir estado e enviar |
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

- Understanding V2: demanda e entidades em contrato estruturado;
- verbalizador V2: linguagem baseada exclusivamente no plano autorizado;
- `PlaybookAdvisor` e setup studies: análise editorial/operacional;
- Whisper: transcrição;
- gateways de TTS: síntese de voz.

Understanding e verbalizador recebem o contexto V2 necessário para suas responsabilidades. Conteúdo específico da organização vem do playbook ativo e do catálogo; comportamento universal fica no código de inteligência.

### Resposta autorizada e fallback seguro

Nos caminhos que compõem uma resposta a partir de uma ação, o resultado
determinístico é a fronteira entre decisão e linguagem:

```text
ActionResult
  -> AuthorizedResponsePlan
  -> draft determinístico + verbalizador V2
  -> validator de atos e texto
  -> resposta validada ou fallback determinístico/handoff
  -> outbound_messages + job message.send
```

`AuthorizedResponsePlan` deriva uma allowlist das fontes já resolvidas: preços
explícitos, labels de agenda, mídia permitida, estado esperado, limite de
caracteres e no máximo uma pergunta. O verbalizador apenas verbaliza o
`ActionResult`; ele não autoriza fatos novos. Antes de a resposta planejada
entrar na outbox, o `ResponseValidator` bloqueia conteúdo vazio, tamanho ou
quantidade de perguntas excedidos, mídia não autorizada, preço ou fato de
agenda fora do plano e promessa sem suporte.

Erro do verbalizador, resposta inválida ou caso que exige avaliação usam o fallback V2.
Quando uma cópia determinística baseada no resultado
real também passa no validator, ela é enviada; quando não passa, o sistema usa
cópia neutra e solicita handoff com razão fixa, sem registrar texto do lead ou
do modelo no trace. Assim, fallback é uma saída segura para uma resposta
bloqueada, não uma aprovação da resposta bloqueada.

O Decision Trace registra somente metadados permitidos dos estágios
`response.plan_built`, `response.validated` e, quando aplicável,
`response.fallback_applied`; contagens e códigos substituem conteúdo,
prompts, preços, horários, mídia e identificadores externos. Uma falha de
observabilidade continua best-effort e não muda a decisão de negócio.

`ConversationOrchestrator`, `IntentClassifier` e `ResponseComposer` permanecem temporariamente
como implementação histórica/testes de referência da V1. Nenhum deles é alcançável por roots
produtivos; comportamento ainda útil deve virar capability ou serviço V2 com contrato próprio.

A decisão para trazer esses comportamentos está em
[Expansão das capacidades de negócio no runtime V2](v2-business-capability-architecture.md), e o
estado de cada função do produto é acompanhado na
[Matriz executável de paridade](v2-capability-parity.md). A matriz também registra qual fonte de
verdade e qual tela existente alimentam cada capability, evitando configuração paralela da V2.

O código e seus testes não autorizam operação externa. Validação com dados
privados aprovados, banco de Lab e qualquer operação de cliente permanecem
gates separados descritos em [Replay e Decision Trace](replay-and-decision-trace.md).

### Conhecimento institucional V2

Perguntas de endereço, horário de funcionamento, orientação de localização, estacionamento e redes
sociais usam o request fechado
`business-information` e a capability read-only `dental-knowledge`. A leitura vem da organização
já reivindicada no `LiveTurnContext`: `address`/`addressComplement`, `businessHours` e
`locationMessage`, com endereço como fallback de orientação somente quando a orientação está
ausente; `parkingInformation` e `socialChannels` são editados na aba Conhecimento. Dado ausente
gera uma resposta específica do tópico. Dado presente inválido — incluindo
caractere de controle, texto não normalizado ou acima de 240 caracteres — falha fechado sem
fallback parcial e sem invenção.

Esse caminho reutiliza o snapshot do turno, não consulta outro tenant, não cria efeito de negócio e
não altera agenda, estado ou configuração. O gate PostgreSQL prova cardinalidade `1/1/1/1/1` e
ausência de novas statements, round trips dentro da tolerância de duas ondas do medidor temporal e
lock hold dentro da tolerância contra uma resposta comum. O trace
registra request, capability, outcome, chamadas e contagens, mas nunca o valor institucional.
Links sociais só passam quando fazem parte inteira do valor estruturado autorizado; qualquer link
adicional continua bloqueado. `mapsUrl` não é exposta por esse contrato.

Reconhecimento e despedida usam os movimentos fechados `acknowledges` e `closes`. Eles produzem
classes semânticas sociais sem efeito e, portanto, não reabrem a conversa com uma pergunta nem
criam estado, job ou ação de negócio.

### Conversation Intelligence V2: runtime único e fail-closed

`V2LiveConversationHandler` é o único runtime conversacional produtivo. Webhooks e workers não
consultam selector de engine, approval vinculada ao build ou configuração `conversation_engine`.
Os valores legados continuam fisicamente no schema durante o primeiro corte, mas são ignorados
pela composição produtiva. A V1 permanece apenas como referência histórica inalcançável e não é
um fallback ou mecanismo de rollback.

O Dental Pack é o dono da provenance capability → Decision → ação concreta → ActionResult →
classe/requisitos. Uma única definição frozen sustenta tipos e validação runtime; a application
boundary pareia Decision preparada e ActionResult antes de persistir. O `conversation-core`
permanece genérico e sem literais dentais.

Um turno pode entrar em automação `live` somente com `conversation_authority.version >= 2`, status
operacional ativo, `live_automation_enabled=true`, auto-reply habilitado, shadow/observe desligado e o controle global
`conversation_runtime_control.live_outbound_enabled=true`. Linha ausente ou leitura inconclusiva
fecha o fluxo. Takeover, consentimento/opt-out e safety gates continuam independentes e
cumulativos.

A permissão `live_automation_enabled` é tenant-scoped, nasce `false`, não escolhe engine e não é
approval por build. Ativação e pausa alteram somente o tenant exato por compare-and-set.

A outbox `live_stream_reply` persiste stream, geração, inbound, claim job, digest do token e versão
de authority. Antes do provider, o sender relê a authority exata, estado atual do tenant, takeover,
consentimento, safety e kill switch. Qualquer divergência bloqueia a entrega sem chamar V1.

Falhas V2 usam budgets duráveis: até três claims do mesmo `message.process` e até dez claims do
mesmo `message.send`. Retry conserva authority, dedupe e efeitos confirmados; o término é uma única
resposta segura autorizada, `handoff_required`, `sent`, `cancelled` ou `dead`, nunca silêncio
indefinido, loop ou recomposição de efeito.

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
  -> briefing conversacional sanitizado do Understanding aceito
  -> verbalização contextual por modelo, sob prazo do turno
  -> validador do texto
  -> texto do modelo ou texto determinístico do mesmo plano
  -> enqueueOutboundMessage
```

O verbalizador recebe o que pode ser dito — intenções autorizadas e valores exatos — e um briefing
fechado que descreve somente request, movimento do diálogo, sentimento, níveis de intenção,
presença de objeção e tipo de ambiguidade. O briefing nasce do Understanding já validado e não
carrega mensagem, histórico, entidade, candidatos ou texto livre da objeção. Ele serve para a
resposta continuar a conversa com naturalidade; nunca autoriza conteúdo. O verbalizador também
recebe estilo e perfil de quem fala, mas não o plano completo, que carrega fato interno e
referência de evidência. A unidade de validação do texto é o valor inteiro, e não o
dígito: cada valor autorizado precisa aparecer completo e todo dígito fora desses trechos é
recusado, o que impede recombinar dois horários oferecidos em um terceiro que não existe. Também
são recusados dinheiro sem valor autorizado — inclusive por extenso —, link, promessa e pergunta
que nenhum ato pediu.

Uma recusa nunca é silêncio: sai o texto determinístico do mesmo plano. Falha ou demora do
provedor têm o mesmo destino, e o Decision Trace registra em `response.validated` qual identidade
escolheu as palavras entregues, a estratégia `hybrid_contextual_v1`, uma chamada de Understanding,
zero ou uma chamada de verbalização e, quando houve recusa, os códigos fechados que a motivaram.
Não existe loop, judge ou repair por modelo: cada estágio chama o modelo no máximo uma vez.

O perfil de quem fala carrega maneira, não conteúdo: nome de apresentação, organização,
especialidade, tom de voz e a orientação editorial de condução, lidos dos donos declarados em
[fontes de verdade](sources-of-truth.md). Preço, diferencial, garantia e resposta a objeção não
viajam como prosa de prompt — eles chegam ao lead como fato autorizado por uma capability, ou não
chegam.

Artefatos de shadow, comparação V1×V2, approval e Cycle I permanecem somente como evidência
histórica e de qualidade; eles não autorizam atendimento. Ativação futura é tenant-scoped, exige
validação limpa e compare-and-set monotônico da authority. Deploy não altera tenant pausado,
desabilitado, demo, prospect ou sem authority V2. O primeiro corte e o rollback sem V1 estão no
[Runbook do runtime V2-only](../operations/v2-only-runtime-rollout.md).

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
