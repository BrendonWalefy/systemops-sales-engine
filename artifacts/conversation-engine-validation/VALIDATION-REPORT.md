# Relatório de validação do handoff V1/V2

## Decisão

**Seguir com ajustes.**

O pacote identificou problemas reais e propôs uma direção de coexistência segura, mas não deve ser aplicado literalmente. Há três correções essenciais:

1. a auditoria corresponde quase exatamente ao `main` atual, não ao `develop`;
2. algumas contagens e severidades foram infladas;
3. parte da migração de configuração e de outbound já existe e não deve ser refeita.

Não foi aplicada nenhuma mudança de comportamento ou banco.

## Matriz executiva

| ID | Veredito | Observação |
|---|---|---|
| P0-01 | Confirmado estaticamente | Janela real; manifestação não reproduzida com produção |
| P0-02 | Parcial | Cadeia existe; “46 atribuições” está incorreto |
| P0-03 | Confirmado | 12 pontos de `pendingPipelineAdvance` |
| P1-01 | Parcial | Contradição real, com ownership parcialmente separado por caminho |
| P1-02 | Confirmado com evidência desatualizada | Vários envios já migraram para outbox |
| P1-03 | Confirmado | Meta ainda chama o orquestrador diretamente |
| P1-04 | Confirmado como risco | Um stream global sem revision/CAS |
| P1-05 | Confirmado | Quatro strings literais em produção |
| P1-06 | Confirmado | Operador persiste antes do envio direto |
| P1-07 | Confirmado | `{ replied }` não participa do outcome do job |
| P2-01 | Confirmado | Guards distribuídos e efeitos antes da obsolescência |
| P2-02 | Confirmado | 8.222 linhas em produção |

## Findings detalhados

### P0-01 — Claim liberado antes do avanço do pipeline

**Status:** confirmado.

**Código/linhas atuais:** `origin/main`: `drain-message-process-queue.ts:63`, `ConversationOrchestrator.ts:7631-7643` e `7707-7709`, `send-message-job.ts:590-600`, `ConversationStateMachine.ts:392-401`.

**Evidência de runtime/teste:** a suíte cobre lease, avanço diferido e sender isoladamente, mas não há teste integrado que combine dois `message.process`, lease, outbox e sender atrasado. O dreno inline introduzido no `main` reduz latência, sem tornar a transição atômica.

**Impacto real:** dois turnos podem decidir a partir do mesmo step e produzir bloco ou mídia duplicados. A classificação como P0 é plausível pelo dano, mas falta medir incidência.

**Condições necessárias:** duas mensagens próximas da mesma conversa; a segunda entra após a liberação do lease e antes do `pipelineAdvance`; ambas chegam a um ramo que consome o mesmo step.

**Patch mínimo:** reservar a revisão/step esperado no commit do turno e rejeitar avanço obsoleto. O sender não deve ser o primeiro escritor da decisão de estado.

**Solução arquitetural:** `TurnCommit` atômico com `turnId`, `expectedStateRevision`, nova revisão e outbox; sender registra apenas receipt.

**Testes necessários:** concorrência determinística com sender bloqueado; retry do sender; outbox fora de ordem; shadow; avanço/exit idempotentes.

**Rollback:** feature flag para voltar ao avanço diferido V1; migration somente aditiva; não remover colunas antigas até estabilidade.

### P0-02 — Sobrescritas sequenciais de `effectiveIntent`

**Status:** parcial.

**Código/linhas atuais:** `origin/main:ConversationOrchestrator.ts:5054-5570`.

**Evidência:** há 16 escritas reais ao identificador no arquivo, incluindo inicialização e normalização final. O número 46 do pacote contou comparações como `===` ou usou uma busca não equivalente a atribuição.

**Impacto real:** a ordem física continua funcionando como precedência implícita, o que dificulta explicação e regressão. Não há evidência suficiente para afirmar P0 isoladamente.

**Condições necessárias:** mensagem satisfaz duas ou mais coerções; uma regra posterior muda o resultado de uma anterior.

**Patch mínimo:** inventariar as regras com nome, prioridade e razão, preservando exatamente a ordem V1; emitir trace em teste/observabilidade.

**Solução arquitetural:** rule engine determinístico que produz decisão e `DecisionTrace`.

**Testes necessários:** tabela de conflitos entre regras; golden tests de precedência; replay anonimizado.

**Rollback:** manter adaptador V1 e desligar emissão/uso do trace por flag.

### P0-03 — Pipeline despachado em vários ramos

**Status:** confirmado.

**Código/linhas atuais:** 12 atribuições a `pendingPipelineAdvance` em `origin/main:ConversationOrchestrator.ts:5716, 6507, 6540, 6605, 6728, 6868, 6940, 7006, 7112, 7235, 7264, 7338`.

**Evidência de runtime/teste:** testes de answer-first e deferred advance cobrem helpers, não uma única política central de execução.

**Impacto real:** mudanças precisam ser repetidas em vários ramos e podem divergir. O risco é estrutural; P0 depende de um cenário concreto.

**Condições necessárias:** qualquer evolução de regra aplicada de forma incompleta entre os ramos.

**Patch mínimo:** extrair um `resolvePipelineEffect()` único chamado depois da ação principal, primeiro em modo de caracterização.

**Solução arquitetural:** `PipelineRuntime` com efeitos tipados, `once`, answer-first e revision.

**Testes necessários:** matriz intenção × estado × step; mídia; Q&A; preço; saudação; agenda; retries.

**Rollback:** roteamento por flag para o dispatcher legado.

### P1-01 — Saudação com donos contraditórios

**Status:** parcial.

**Código/linhas atuais:** `ResponseComposer.ts:39-69`, contexto de primeira mensagem em torno de `550-552`, ação `greeting` em `875-878`; helpers determinísticos no início do orquestrador.

**Evidência:** o mesmo prompt pode informar que o sistema já saudará e, no contexto da ação `greeting`, ordenar que a LLM use saudação. Há deduplicação reparadora no composer e stripping/prepend no orquestrador. Em contrapartida, vários comentários atuais já delimitam donos por caminho.

**Impacto real:** duplicação ainda pode aparecer em caminhos não equivalentes; regex mascara conflito. A afirmação “ninguém é dono” é forte demais: há ownership intencional, porém fragmentado.

**Condições necessárias:** primeiro contato ou reinício em caminho composto pela LLM, especialmente quando o action context vence a regra geral.

**Patch mínimo:** definir `greetingMode` no plano e remover a instrução conflitante do action context.

**Solução arquitetural:** renderer determinístico é o único dono da saudação; LLM nunca a gera.

**Testes necessários:** primeiro contato, reinício, saudação temporal mid-conversation, pipeline com mídia e múltiplos parts.

**Rollback:** restaurar action context anterior mantendo dedupe.

### P1-02 — Múltiplas arquiteturas de envio

**Status:** confirmado com evidência parcialmente desatualizada.

**Código/linhas atuais:** fluxo principal usa `enqueueOutboundMessage`; ainda há envio direto no send do operador, webhook Z-API operacional, notificações ao staff, depósito e recovery manual.

**Evidência:** inventário está em `CURRENT-RUNTIME-FLOW.md`. Lembrete ao lead, follow-up, pós-atendimento, recovery cron e reativação já usam outbox no `main`.

**Impacto real:** retry, status, ordenação e observabilidade variam por caminho. Mensagem manual pode constar como enviada sem entrega.

**Condições necessárias:** falha do provider, concorrência ou retry em qualquer caminho direto.

**Patch mínimo:** migrar primeiro o envio manual do operador, por ser lead-facing e já persistir incorretamente.

**Solução arquitetural:** `OutboundCommandBus` comum com políticas por categoria/destinatário.

**Testes necessários:** falha antes/depois do provider, echo, attachment, ordenação e retry.

**Rollback:** flag por tipo de comando para o sender direto anterior.

### P1-03 — Meta ignora ingress durável

**Status:** confirmado.

**Código/linhas atuais:** `origin/main:src/app/api/whatsapp/webhook/route.ts:30-70`; chamada direta em `58`.

**Evidência:** Z-API usa `persistInboundEventAndEnqueue`; Meta aceita apenas texto e chama `handle()`.

**Impacto real:** sem retry durável, dedupe comum, batching e métricas equivalentes.

**Condições necessárias:** organização usando Meta Cloud API.

**Patch mínimo:** adapter Meta normaliza um payload canônico e publica `InboundEvent`.

**Solução arquitetural:** todos os providers terminam no mesmo `InboundEventBus`.

**Testes necessários:** assinatura/verificação, duplicata, texto, mídia ignorada/suportada, clínica ausente, retry.

**Rollback:** flag de ingress por provider.

### P1-04 — Último estado global

**Status:** confirmado como risco de modelagem.

**Código/linhas atuais:** `ConversationStateMachine.ts:97-110` e `392-401`.

**Evidência:** menu, slots, pipeline, revisão, depósito e reset compartilham o mesmo stream. A leitura devolve apenas a última linha global.

**Impacto real:** um estado pode ocultar outro e não existe revisão esperada. Não foi demonstrado que todos esses estados deveriam coexistir em todos os casos.

**Condições necessárias:** dois fluxos ortogonais ativos ou transições concorrentes.

**Patch mínimo:** tornar transições críticas revisionadas; não “buscar por tipo” sem modelar encerramento do slice.

**Solução arquitetural:** slices explícitos (`navigation`, `booking`, `pipeline`, `review`) com revision.

**Testes necessários:** interleavings de depósito/pipeline/review/reset e concorrência.

**Rollback:** dual-read com preferência V1; escrita aditiva.

### P1-05 — Interpolação literal de `slotLookaheadDays`

**Status:** confirmado.

**Código/linhas atuais:** `origin/main:ConversationOrchestrator.ts:5793, 6023, 6164, 6269`.

**Evidência:** quatro strings usam aspas comuns e podem enviar `${clinic.slotLookaheadDays}` literalmente.

**Impacto real:** texto incorreto para o lead.

**Condições necessárias:** solicitação fora da janela nos quatro ramos.

**Patch mínimo:** helper determinístico único com o valor numérico.

**Solução arquitetural:** copy de agenda centralizada.

**Testes necessários:** os quatro ramos e valores por organização.

**Rollback:** reversão simples do commit, sem schema.

### P1-06 — Envio do operador persiste antes de entregar

**Status:** confirmado.

**Código/linhas atuais:** `api/conversations/[conversationId]/send/route.ts:137-168`.

**Evidência:** a mensagem é inserida com `externalId:null`; provider é chamado diretamente; falha retorna 502 e deixa a linha sem estado explícito de falha/retry.

**Impacto real:** inbox mostra uma mensagem que não chegou e não há recuperação automática.

**Condições necessárias:** falha ou timeout do provider após persistência.

**Patch mínimo:** criar outbox `operator_message` e status pending; worker atualiza external ID e delivery.

**Solução arquitetural:** mesmo bus de outbound, mantendo autoria e política distintas da automação.

**Testes necessários:** texto, attachment, falha, retry, echo e clique duplo idempotente.

**Rollback:** flag por organização/canal.

### P1-07 — Inbound `processed` sem outcome semântico

**Status:** confirmado.

**Código/linhas atuais:** `process-message-job.ts:108-124`; catch do orquestrador em `ConversationOrchestrator.ts:7669-7705`.

**Evidência:** o retorno de `handle()` não é lido. `replied:false` ainda termina como `processed`.

**Impacto real:** handoff intencional, supersession, lease perdido e falha absorvida viram o mesmo terminal; recuperação e métricas ficam impossíveis.

**Condições necessárias:** qualquer retorno `replied:false` sem exceção.

**Patch mínimo:** `TurnOutcome` discriminado e mapeamento explícito para terminal/retry.

**Solução arquitetural:** outcome faz parte do contrato do engine e do evento.

**Testes necessários:** todos os outcomes, retryable failure, handoff e superseded.

**Rollback:** persistir outcome adicional sem mudar inicialmente a decisão de retry.

### P2-01 — Proteções de rajada distribuídas

**Status:** confirmado.

**Código/linhas atuais:** lease, `latestAfterClaim`, debounce, rapid throttle, supersession de mídia e guards pós-composição estão em regiões diferentes do orquestrador e do worker.

**Evidência:** testes unitários cobrem proteções isoladas; não há um coordenador único do burst.

**Impacto real:** efeitos podem nascer antes de o turno ser considerado obsoleto e cada efeito novo precisa conhecer guards anteriores.

**Condições necessárias:** rajada que cruza janelas de debounce/lease e gera side effects.

**Patch mínimo:** produzir um `turnId` e registrar por que um turno foi superseded.

**Solução arquitetural:** `ConversationTurnCoordinator` agrega a rajada antes de decidir.

**Testes necessários:** relógio falso, mensagens a 0/1/4/13 segundos, mídia+texto e jobs paralelos.

**Rollback:** coordenador em shadow de decisão, sem bloquear V1.

### P2-02 — Orquestrador monolítico

**Status:** confirmado.

**Código/linhas atuais:** 8.222 linhas em `origin/main`; 7.543 em `origin/develop`.

**Evidência:** a classe combina DB, agenda, intenção, pipeline, mídia, depósito, handoff, TTS, custos e outbound.

**Impacto real:** alto raio de mudança e testes difíceis. Tamanho não é, sozinho, justificativa para rewrite.

**Condições necessárias:** manutenção contínua em regras interdependentes.

**Patch mínimo:** criar seams e testes de caracterização antes de mover código.

**Solução arquitetural:** extração incremental: turn coordinator, rules, pipeline runtime, response plan e outbound.

**Testes necessários:** equivalência V1 por replay e golden traces.

**Rollback:** cada seam mantém adaptador para implementação anterior.

## Novos achados

### N-01 — `develop` não representa a produção atual

`main` está 27 commits e oito migrations à frente. Começar implementação diretamente sobre `develop` produziria análise e patches sobre código antigo.

**Ação necessária:** decisão explícita de back-merge/reconciliação de `main` para `develop`, seguindo change control.

### N-02 — Compilação legada de playbook é silenciosamente inócua

`activatePlaybookVersion()` ainda calcula `playbook`, `commercialPolicy` e `toneOfVoice` para atualizar `organizations`, mas essas colunas já não existem no schema. O objeto espalhado passa no TypeScript; o Drizzle gera SQL apenas para `updated_at`.

O runtime correto lê `resolveActiveEditorialConfig()`, portanto isso não quebra a leitura atual. Porém o código comunica um dual-write que não acontece e deve ser removido em patch de limpeza separado.

### N-03 — A documentação operacional de outbound ficou para trás

O documento canônico ainda precisa refletir que vários crons já usam outbox e que produção faz dreno inline do sender no message-worker.

### N-04 — Falta teste integrado para o risco mais grave

`PipelineDeferredAdvance.test.ts` caracteriza a intenção do fix, mas não testa os componentes reais juntos. A prioridade inicial deve ser construir a reprodução determinística antes de alterar o modelo de estado.

## Conclusão

A direção V1/V2 é válida se for usada como migração incremental e mensurável. Recomenda-se:

1. reconciliar branches;
2. corrigir bugs concretos pequenos;
3. provar e fechar a corrida com teste integrado e commit de turno revisionado;
4. unificar ingress/outbound gradualmente;
5. somente então introduzir engine V2 shadow puro.

Parar aqui para revisão antes de qualquer mudança de comportamento ou banco.
