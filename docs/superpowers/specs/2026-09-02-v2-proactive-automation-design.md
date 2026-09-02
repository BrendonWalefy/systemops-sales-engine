# Automações proativas no runtime V2

Status: aprovado como a sétima fatia da matriz de paridade V2. A V1 é somente referência
histórica e não participa de decisão, fallback, configuração ou execução.

## Objetivo

Submeter follow-up, lembrete, recuperação, pós-atendimento e campanha ao mesmo limite de
autoridade do runtime V2. Os produtores e suas regras de negócio existentes permanecem donos de
quando e do que propor; uma política V2 compartilhada decide se o tenant pode automatizar, o
outbox registra a intenção de forma atômica e o sender revalida imediatamente antes da entrega.

Esta entrega não cria outro motor conversacional, capability inbound, tabela, cron ou worker. Ela
fecha o caminho que já existe e torna cada tentativa rastreável do produtor até o provedor.

## Escopo e donos

| Responsabilidade | Dono |
| --- | --- |
| Selecionar leads, compromissos e regras elegíveis | produtores existentes |
| Produzir conteúdo e validar o plano | serviço específico + response plan V2 |
| Autorizar criação proativa | `V2OnlyAutomationPolicy` compartilhada |
| Persistir intenção e deduplicar | `OutboundMessageStore` |
| Criar a mensagem canônica visível | `SendMessageJob`, depois do preflight final |
| Revalidar e entregar | preflight PostgreSQL + sender |
| Explicar decisão e entrega | decision trace com `turnId` estável |

As categorias proativas fechadas são `follow_up`, `reminder`, `campaign`, `recovery` e
`operational`. `human_manual` e `system` continuam explícitas, mas não são automações proativas e
não adquirem regras novas por esta fatia.

## Envelope proativo fechado

Cada nova automação carrega um envelope versionado com `kind`, `leadId`, `conversationId`,
`turnId` e `agentMessagePersistence: "sender"`. O `turnId` é gerado antes da composição e
permanece igual no plano, validação, outbox, job, preflight e resultado de entrega.

O produtor não insere uma mensagem `agent` antes da autorização. O sender cria exatamente uma
mensagem canônica depois do último preflight e reutiliza ou valida essa mesma mensagem em retry.
Assim, bloqueio por política não deixa resposta falsa no histórico e crash não duplica conteúdo.
Payloads históricos já enfileirados permanecem legíveis para drenagem, mas todos os produtores
novos usam o envelope fechado.

## Política de criação

Antes de compor ou persistir qualquer efeito, o produtor consulta a mesma política V2 usada pelo
runtime live. A criação atômica do outbox repete os fatos críticos sob lock curto e exige:

- `conversation_authority.version >= 2` no tenant exato;
- `operational_status = active`;
- `auto_reply_enabled = true`;
- permissão live do tenant habilitada;
- `shadow_mode_enabled = false` e tenant não demo;
- kill switch global permitindo automação;
- categoria e `authorization_kind` correspondentes;
- lead e conversa pertencentes ao mesmo tenant e entre si.

Tenant pausado, desabilitado, demo, prospect, shadow ou sem authority V2 não cria outbound. A
negação nunca redireciona para V1. O lock global é compartilhado com a ativação do kill switch,
para que criação concorrente não atravesse a mudança de estado.

## Preflight de entrega

Imediatamente antes do provider call, o sender revalida em banco:

- authority version 2 e authorization version persistida válida;
- kind/categoria e vínculo exato tenant/lead/conversa/payload;
- status operacional ativo, auto reply, live permit, shadow/demo e kill switch;
- consentimento e opt-out;
- takeover/pausa e obsolescência aplicáveis à categoria;
- safety gates, estado terminal, dedupe e identidade da mensagem canônica.

Revogação explícita de consentimento bloqueia todas as automações, inclusive lembrete. Lembretes
continuam transacionais para quiet hours e caps; follow-up, campanha e recuperação mantêm os gates
de cadência, horário e obsolescência já existentes. Congelamento de segurança e kill switch
bloqueiam todas as categorias proativas. Alteração entre enqueue e entrega é detectada no sender.

## Conteúdo e efeitos

Cada produtor continua dono de sua regra e reutiliza o response-plan/validação existente. Esta
fatia não move texto para o orchestrator nem duplica política editorial. A IA verbaliza quando o
produtor já permite; código determinístico decide elegibilidade, categoria, dedupe e envio.

Não há recomposição após um outbox persistido. Retry reutiliza payload, `turnId`, mensagem canônica
e dedupe originais. Cada ação lógica produz no máximo um outbound, um send job e uma mensagem.

## Rastreabilidade e privacidade

O trace usa eventos fechados para seleção, plano, validação, autorização de criação, preflight e
entrega. Ele registra IDs opacos, categoria, reason codes, contagens e timestamps. Não registra
telefone, texto de mensagem, prompt, payload do provedor ou credenciais.

Uma automação rejeitada deixa claro se falhou no produtor, na criação atômica ou no preflight
final. Rejeições do modelo permanecem no cofre de evidência existente, sem expor conteúdo nos
traces operacionais.

## Falha, retry e terminalidade

- Falha antes do outbox: zero mensagem canônica, job ou envio; nova avaliação só ocorre por um
  evento legítimo futuro.
- Falha depois do outbox e antes do provider: retry reutiliza o mesmo job lógico, payload,
  `turnId` e mensagem canônica.
- Falha transitória de entrega respeita o budget existente; ao esgotar, termina em falha auditável
  ou handoff, sem loop e sem recompor conteúdo.
- Mudança de política antes do send: preflight falha fechado; nunca envia nem cai para V1.
- Dedupe e estados terminais continuam válidos por toda a vida do outbound, inclusive `sent`.
- Cross-tenant ou envelope inconsistente falha antes do provider call.

## Performance e custo

Não há polling, heartbeat, worker contínuo, migration ou atividade adicional em idle. A política do
produtor usa leituras indexadas existentes. A criação continua uma transação SQL atômica e bounded;
o preflight continua uma consulta bounded imediatamente antes do provider.

Os gates usam o baseline V2 atual e exigem:

- latência p95 do produtor até enqueue no máximo 25% acima do fluxo correspondente;
- zero chamadas adicionais ao modelo e zero tokens adicionais;
- no máximo duas leituras indexadas adicionais antes do provider;
- um outbound e um job por ação lógica;
- lock adicional p95 de até 20 ms, sem lock ou scan table-wide;
- nenhum aumento mensurável de compute-active time do Neon em idle.

## Rollout e rollback

O deploy não ativa tenant. Após CI e build, o primeiro corte mantém somente SystemOpsLab elegível,
com authority V2 validada. O kill switch é o rollback imediato; correção forward é o rollback de
software até existir um build V2-only anterior comprovadamente saudável. Nenhum rollback habilita
V1. Workers antigos devem ser drenados antes da observação do novo caminho.

Não será enviado smoke sintético. Depois de produção estável, um único teste real solicitado ao
usuário deve provar trace, outbox, preflight, entrega única e ausência de pendências.

## Critérios de aceitação

- Os cinco tipos proativos usam uma política V2 única antes da composição e no banco.
- Authority menor que 2, kill switch, tenant inválido, opt-out ou vínculo divergente impedem
  criação ou entrega conforme o momento da mudança.
- Nenhuma resposta aparece no histórico antes do preflight final.
- Retry e concorrência produzem uma mensagem, um outbound, um job e no máximo um envio.
- Todos os produtores emitem envelope e trace fechados; payload histórico continua drenável.
- Testes PostgreSQL, performance, corpus, `npm run verify`, build e CI ficam verdes antes da
  promoção, sem migration e sem atividade nova em idle.
