# Conversation Intelligence V2 — Internal Lab Live Design

Data: 2026-08-17
Status: arquitetura aprovada; aguardando revisão documental do owner
Escopo: authority interna, shell live mínimo da V2, SystemOps Dental Lab e dogfooding em produção

## 1. Objetivo

Colocar a Conversation Intelligence V2 em operação real, tenant-scoped e reversível no
**SystemOps Lab**, sem transformar essa autorização interna em aprovação para cliente externo.
O owner deve terminar a entrega podendo usar o Inbox atual para ler conversas sintéticas
multi-turn, conversar pelo próprio número com a V2 real e alternar o tenant com segurança entre
V2 e V1.

Esta entrega reutiliza o runtime e a infraestrutura existentes. Não cria outro produto, Lab,
dashboard, Inbox, worker, fila, booking, outbox, sender ou framework de avaliação.

## 2. Decisão prospectiva e limites de autoridade

O resultado formal do Cycle I não é reinterpretado. A ausência dos dois reviewers humanos
distintos e calibrados continua deixando o critério qualitativo como `not_measurable` ou
`pending_human_review`, conforme o artifact canônico que puder ser produzido. Nenhuma authority
local, avaliação automática ou revisão posterior do owner pode transformar esse estado em PASS.

Esta spec introduz uma autorização separada para dogfooding interno:

```text
INTERNAL_LAB_SMOKE_AUTHORIZED
INTERNAL_LAB_READY
```

`INTERNAL_LAB_SMOKE_AUTHORIZED` resolve a circularidade operacional: autoriza uma janela curta e
controlada de smoke no build de produção, ainda sem declarar o Lab pronto. Depois do smoke,
rollback bidirecional, execução segura das personas, avaliação automática e verificação do Inbox,
`INTERNAL_LAB_READY` autoriza a continuidade do dogfooding. Ambos os estados pertencem ao mesmo
contrato pequeno de aprovação interna; não são um novo sistema de gates.

As duas decisões:

- autorizam somente o tenant e o canal inequivocamente identificados como SystemOps Lab;
- exigem `isTest=true`, `isDemo=false` e status operacional `test`;
- vinculam build, tenant config, canal, critérios e evidence digests;
- são assinadas por uma authority Ed25519 local/internal dedicada;
- não alteram o gate report do Cycle I;
- não satisfazem human review formal;
- não podem ser registradas ou aceitas para tenant externo;
- não constituem production authority futura para cliente externo.

O parser usa a public root dedicada
`CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY`, diferente das roots do Cycle I, review e
replay. A private key fica fora do repositório, com permissão restrita, e nunca entra em artifact,
log, shell output ou Git. O payload assinado usa o domínio fechado
`systemops.conversation-v2.internal-lab-approval.v1`.

## 3. Ordem de execução

O programa é dividido em três entregas sequenciais, mas o artifact final de medição automática é
gerado sobre o build que efetivamente será implantado:

1. preparar authorities locais, mecanismos canônicos de manifest/assinatura e evidência
   automática sem fabricar material ausente;
2. implementar e revisar o shell live mínimo, mantendo `v2_internal` fail-closed até existir
   aprovação interna válida;
3. executar a medição automática autoritativa no HEAD final, produzir a aprovação de smoke,
   implantar sem ativação global, confirmar o build, registrar a aprovação, configurar o Lab,
   executar smoke/rollback/personas, verificar artifacts e Inbox e somente então emitir
   `INTERNAL_LAB_READY`.

Isso evita usar como justificativa de deploy uma medição vinculada a bytes anteriores ao shell
live. Artifacts intermediários podem ser produzidos para diagnóstico, mas não autorizam o build
final.

## 4. Único boundary de seleção de engine

`TenantEngineRouter` é o único componente que seleciona V1 ou V2. Nenhum outro módulo pode
ramificar por `v1`, `v1_with_v2_shadow` ou `v2_internal`, exceto os parsers/objetos de valor que
validam o vocabulário fechado da configuração.

O router implementa o mesmo port `conversationHandler` consumido por
`ProcessMessageJobHandler`. Ele recebe dois handlers já construídos:

```text
TenantEngineRouter
  ├─ V1ConversationHandler  -> ConversationOrchestrator existente
  └─ V2LiveConversationHandler
```

O router resolve a policy exatamente uma vez por turno e `clinicId`, depois que o modo de
automação já foi resolvido. Não existe cache cross-tenant. A ordem é:

1. `disabled` e `observe` mantêm a precedência atual e nunca executam V2;
2. `v1` chama a V1;
3. `v1_with_v2_shadow` chama a V1 e conserva o shadow existente;
4. `v2_internal` chama V2 somente quando todas as condições de Internal Lab são válidas;
5. policy inválida, runtime ausente, approval ausente, build divergente, tenant divergente ou
   canal não autorizado falham fechado para V1 antes de qualquer chamada ou efeito V2.

Um teste arquitetural percorre o grafo local e impede condicionais de engine fora do router,
composition root, schemas fechados e testes.

## 5. Regra de não-fallback no mesmo turno

Depois que `TenantEngineRouter` entrega o turno ao `V2LiveConversationHandler`, a V1 não pode ser
chamada para o mesmo `turnId`.

Falhas da V2 seguem o contrato seguro da própria V2:

- erro antes de write: resposta segura, `no_safe_response` ou handoff determinístico;
- write recusado: outcome de falha correspondente, sem alegar sucesso;
- write confirmado e composição falha: fallback V2 baseado no ActionResult real ou handoff;
- erro de observabilidade: best-effort, sem mudar a decisão;
- erro técnico terminal: trace sanitizado e atenção interna, sem executar V1.

Rollback significa alterar a feature flag do tenant. Ele passa a valer no turno seguinte. Essa
separação impede duplicação de booking, state transition, outbound ou qualquer outro efeito.

## 6. Shell live mínimo

O shell preserva e reutiliza obrigatoriamente:

- `ProcessMessageJobHandler` para resolução do inbound, modo de automação, lifecycle e ack;
- tenant resolution e dedupe existentes;
- repositories e state machine existentes;
- `BookingService` para qualquer booking;
- `enqueueOutboundMessage` e durable outbox existentes;
- `SendMessageJobHandler` e sender existentes;
- persistence de leads, conversations e messages consumida pelo Inbox atual.

Fluxo canônico:

```text
webhook existente
  -> inbound_events + message.process
  -> ProcessMessageJobHandler
  -> TenantEngineRouter
  -> V2LiveConversationHandler
  -> Gate V2
  -> Understanding
  -> claims + coordinator
  -> capability decide
  -> capability execute por ports autorizados
  -> ActionResult
  -> V2 AuthorizedResponsePlan
  -> composer + validator + fallback V2
  -> enqueueOutboundMessage
  -> outbound_messages + message.send
  -> SendMessageJobHandler
  -> sender existente
```

O handler V2 não recebe channel adapter, outbox store cru, Google Calendar client ou conexão SQL.
Ele recebe application ports e serviços existentes. Writes de agenda usam `BookingService`;
estado usa a boundary existente; outbound usa exclusivamente `enqueueOutboundMessage`.

Nenhum worker ou queue adicional é criado. O job existente mantém exclusão por conversa, leases,
retry e DLQ. A V2 não cria caminho direto para WhatsApp, calendário, banco ou sender.

## 7. Estado, dedupe e atomicidade

Cada inbound preserva o `turnId` derivado do `inboundEventId`. O shell registra mensagens e
transições pelas mesmas boundaries da V1 e usa dedupe keys existentes. Um retry do job não pode:

- executar novamente um write já confirmado;
- criar uma segunda mensagem outbound equivalente;
- perder ou reverter `conversation_states`;
- misturar configuração ou dados entre tenants;
- recompor uma resposta diferente depois que a outbox foi persistida.

Quando um efeito real e uma state transition precisam permanecer coerentes, a implementação usa
o contrato transacional/saga existente; não cria uma transação ou ledger paralelo para V2.

## 8. Rollback bidirecional

Rollback precisa ser demonstrado nos dois sentidos usando a mesma conversa e turnos distintos:

```text
turno A em V2
  -> flag V2 para V1
turno B em V1
  -> flag V1 para V2
turno C em V2
```

A prova exige:

- state anterior disponível depois de cada troca;
- nenhuma repetição do inbound ou outbound anterior;
- dedupe preservado por `messageId`/`turnId`;
- ordem da durable outbox preservada;
- nenhum booking ou intended effect duplicado;
- trace indicando a engine efetivamente selecionada por turno;
- mudança da flag aplicada somente a turnos novos.

O teste existe em nível de application/integration antes do deploy e é repetido como smoke
controlado no tenant Lab. Depois da prova `V2 -> V1 -> V2`, o Lab termina configurado em
`v2_internal`.

## 9. Contrato de Internal Lab approval

O artifact é pequeno, fechado e content-bound. Ele contém, no mínimo:

- versão e decisão (`INTERNAL_LAB_SMOKE_AUTHORIZED` ou `INTERNAL_LAB_READY`);
- commit, tree digest, source digest e runtime do build;
- digest da identificação esperada do tenant/canal Lab;
- digest da configuração e playbook aplicados;
- referência exata ao gate report honesto do Cycle I e seu status qualitativo;
- critérios fechados e evidence digests;
- timestamp e expiração curta para smoke; sem expiração implícita para READY;
- assinatura Ed25519 da authority Internal Lab.

Critérios mínimos pré-smoke:

- H safety/entailment preservado;
- Tasks 1–7 tecnicamente fechadas;
- revisão de arquitetura/código sem Critical ou Important aberto;
- medição automática possível executada no build final, com ausências preservadas;
- `TenantEngineRouter` como único boundary;
- feature flag tenant-scoped e fail-closed;
- no-fallback no mesmo turno;
- testes de tenant isolation, dedupe, state, BookingService, outbox e sender verdes;
- rollback bidirecional verde em ambiente controlado;
- migrations aditivas/seguras, quando existirem;
- `npm run verify` verde;
- identidade SystemOps Lab determinada sem ambiguidade;
- zero tenant externo alcançável pelo approval.

Critérios adicionais para `INTERNAL_LAB_READY`:

- deploy do build exato concluído;
- smoke real do número interno verde;
- prova em produção de `V2 -> V1 -> V2` verde;
- mensagens e respostas persistidas e visíveis no Inbox atual;
- personas sintéticas executadas sem entrega externa;
- automated evals e artifacts produzidos;
- observabilidade mínima verificada;
- estado final do tenant em `v2_internal`.

O parser registra approvals válidos em registry privado. Cast TypeScript, JSON estrutural, HMAC
caller-controlled ou public key fornecida como argumento não concedem autoridade.

## 10. SystemOps Dental Lab

O Lab existente é usado; não se cria um segundo Lab. Antes de qualquer write, o procedimento
resolve de forma determinística:

- organization/tenant esperado;
- `isTest=true` e `isDemo=false`;
- status operacional `test`;
- owner e membership internos;
- canal e número SystemOps controlados;
- Inbox e conversation persistence associados ao mesmo tenant;
- agenda interna ou recurso de calendário explicitamente de teste.

Mais de um candidato, campo contraditório ou canal não inequivocamente interno interrompe a
operação. IDs não são inferidos por nome parcial.

Configuração é idempotente e usa somente campos, admin actions, repositories e tabelas existentes.
Quando não houver action adequada, um script de manutenção explícito pode aplicar o estado pelo
repository/DB existente, com dry-run, snapshot dos registros afetados e operação de rollback. Não
há migration ou tabela exclusiva do Lab.

## 11. Configuração odontológica

Nome de apresentação: `SystemOps Dental Lab`.

O playbook é consultivo e comercial, limitado às capabilities existentes:

- responder primeiro;
- no máximo uma pergunta principal por vez;
- diagnosticar sem impedir pedido direto de agendamento;
- não inventar preço, condição, disponibilidade, resultado, desconto ou garantia;
- usar handoff/escalation determinísticos;
- abordar lentes/facetas em resina, avaliação, preço, disponibilidade, agenda, localização,
  comparação, urgência e objeção somente quando representáveis.

O catálogo contém apenas material necessário ao dogfooding:

- lentes/facetas em resina e variações já suportadas;
- avaliação;
- clareamento para cenários multi-intent/cross-sell;
- manutenção apenas se o contrato atual representar esse tratamento;
- preços e condições explicitamente cadastrados;
- horários e profissionais sintéticos de teste;
- endereço fictício explicitamente marcado como Lab.

As fontes são corpus e histórico sanitizado/autorizado do repositório. Padrões de Ximendes e
Vitalli podem inspirar estrutura e cobertura, nunca nome, PII, credencial, conversa privada ou
dado operacional real. Valor sem fonte autorizada é fictício e identificado como dado de teste na
configuração editorial/operacional já existente.

## 12. Personas e conversas multi-turn

Personas ficam em um JSON simples sob `evals/systemops-lab/personas.json`. Cada entrada descreve
identidade sintética, motivação, estilo de mensagem, restrições e condição de término. Não contém
resposta esperada nem veredito fabricado.

O conjunto cobre 15 perfis: decidido, sensível a preço, comparador, estético indeciso,
durabilidade, urgente, multi-intent, desconfiado, fragmentado, objeção de preço, ambíguo, handoff,
adversarial, mudança de assunto e pronto para fechar.

Um script específico do Lab executa o menor loop necessário:

```text
persona -> inbound real persistido -> message.process -> TenantEngineRouter -> V2
        -> durable outbox -> sender/capture -> resposta persistida
        -> persona lê a resposta -> próximo turno
```

Cada cenário tem limite conservador de turnos e termina por informação satisfeita, proposta,
intended booking, booking controlado, handoff, opt-out, `no_safe_response` ou max-turns.

## 13. Entrega segura das personas

Contatos sintéticos usam identificadores de Lab reconhecíveis, nunca telefones reais de terceiros.
Eles atravessam persistence, conversation, engine e outbox reais. Somente a fronteira irreversível
de canal é substituída pelo `ReplayOutboundCapture` existente.

O wiring de captura é admitido apenas quando todas as condições são verdadeiras:

- tenant exato do SystemOps Lab;
- `isTest=true`, `isDemo=false`, status `test`;
- Internal Lab approval registrado;
- execução iniciada pelo runner Lab autenticado;
- endereço sintético no formato fechado do Lab;
- correlation/run ID pertencente à execução ativa.

O sender e sua persistência continuam reais; apenas WhatsApp/TTS/storage externos viram efeitos
capturados, como no replay atual. A composição fail-closed garante que um endereço sintético nunca
alcance o channel adapter real. O wiring reutiliza `ReplayOutboundCapture`; não cria provider,
sender, queue ou delivery framework novo.

As respostas persistidas aparecem como mensagens da conversa no Inbox atual. O runner lê a
resposta persistida/capturada, não um retorno paralelo do modelo, antes de produzir o próximo
turno.

## 14. Número real do owner

O número real SystemOps é um caminho separado das personas. Ele não usa identificador sintético
nem `ReplayOutboundCapture` e atravessa o canal WhatsApp real já associado ao Lab.

A ativação ocorre somente depois de:

- shell live revisado;
- approval de smoke válido;
- config/playbook Lab aplicados e validados;
- canal confirmado como interno;
- rollback bidirecional pré-deploy verde;
- smoke inicial sem efeito externo indevido.

O owner envia uma mensagem normal pelo próprio telefone e recebe resposta da V2 pelo sender real.
A conversa deve aparecer no Inbox existente. Nenhum cliente externo ou outro número é usado.

## 15. Artifacts e avaliação

Cada execução cria somente arquivos simples:

```text
evals/systemops-lab/<run-id>/transcript.md
evals/systemops-lab/<run-id>/trace.json
evals/systemops-lab/<run-id>/evaluation.json
evals/systemops-lab/latest-summary.md
```

`transcript.md` contém persona, cenário, mensagens e respostas reais por turno, automated result e
`OWNER REVIEW: PENDING`. `trace.json` contém apenas campos sanitizados necessários: Understanding,
capabilities, Decision, ActionResult/intended effect, authorized plan, validator, FinalText,
model, latência, tokens/custo quando reais e errors allowlisted. Secrets, PII, URLs privadas,
provider payload e IDs opacos não entram.

Automated eval reutiliza instrumentos existentes e mede somente quando há evidência:

- factual correctness;
- unauthorized facts;
- price e subject binding;
- scheduling correctness;
- success/failure inversion;
- escalation;
- desconto ou garantia inventados;
- relevance e journey advancement;
- critical regression e safety.

O judge experimental continua non-gating. Automated eval não substitui human reviewers formais
nem review do owner. `latest-summary.md` lista run, persona, cenário, status automático, transcript
e estado de owner review.

## 16. Observabilidade e privacidade

Cada turno registra engine selecionada, reason code, stage, latência, model call, fallback,
outcome, outbox e delivery status sem conteúdo sensível no Decision Trace. Texto completo fica
somente em messages do tenant Lab e nos artifacts sanitizados autorizados.

Métricas e logs não carregam mensagem, prompt, telefone, nome, secret, URL ou provider payload.
Tenant ID e channel binding usados em approvals são representados por digests; os valores reais
permanecem em configuração local/protegida.

Qualquer evidência de cross-tenant, envio para contato não autorizado, duplicate effect, secret em
artifact ou divergência entre build e approval revoga o gate e aciona rollback para V1.

## 17. Change control e deploy

Esta autorização não permite push direto em `main`. O fluxo permanece:

1. branch focada e commits pequenos;
2. TDD e revisão independente por tarefa;
3. `npm run verify` exatamente, sem `.env.local`;
4. PR para `develop`;
5. CI e preview verdes;
6. merge em `develop` após aprovação;
7. promoção `develop -> main` após validação completa;
8. emissão de `INTERNAL_LAB_SMOKE_AUTHORIZED` vinculada ao build exato;
9. deploy desse build com engine global ainda em V1;
10. confirmação da identidade do build e registro da aprovação de smoke;
11. ativação exclusiva do Lab, smoke e rollback bidirecional;
12. restauração do Lab para V2, personas, artifacts, automated eval e verificação do Inbox;
13. emissão/registro de `INTERNAL_LAB_READY` somente após todos os seus critérios estarem
    comprovados.

Migrations, se necessárias para comportamento geral já aprovado, são geradas pelo Drizzle e
aplicadas antes do código que as consome, com rollback documentado. Esta spec não autoriza schema
novo exclusivo do Lab.

## 18. Verificação

Antes do deploy:

- testes focados do router, approval e live handler;
- teste arquitetural de boundary única;
- testes de no-fallback e duplicate effects;
- tenant isolation e channel safety;
- state/dedupe/outbox através de V2, V1 e V2;
- BookingService e agenda;
- response entailment/validator/fallback;
- replay capture de contatos sintéticos;
- PII/artifact audit;
- db metadata, lint, typecheck e `npm run verify`;
- revisão independente sem Critical ou Important aberto.

Depois do deploy:

- build/runtime/approval binding;
- readiness local e remoto do SystemOps Lab;
- smoke pelo número real interno;
- `V2 -> V1 -> V2` com state, dedupe e outbox preservados;
- persona runs e captura sem channel call real;
- confirmação programática de leads, conversations, messages e outbound no tenant Lab;
- confirmação de visibilidade no Inbox atual;
- automated evals e artifacts;
- observabilidade e rollback final disponíveis.

Falha em qualquer invariável interrompe a ativação, mantém ou retorna o tenant a V1 e registra o
estado real. Testes verdes não substituem evidência operacional ausente.

## 19. Critério de conclusão

A entrega termina apenas quando:

1. o build aprovado está em produção;
2. `INTERNAL_LAB_READY` está válido para um único tenant/canal interno;
3. SystemOps Dental Lab está configurado idempotentemente;
4. `conversation_engine = v2_internal` no estado final;
5. o número real do owner recebe resposta V2;
6. personas multi-turn atravessaram persistence, engine e outbox reais;
7. nenhuma persona tentou delivery externo;
8. conversas completas estão no Inbox atual;
9. rollback `V2 -> V1 -> V2` foi comprovado;
10. automated evals e artifacts foram gerados;
11. `OWNER REVIEW: PENDING` e instruções de revisão estão presentes;
12. Cycle I e human-review continuam reportados honestamente.

## 20. Fora de escopo

- cliente externo;
- rollout percentual;
- remoção da V1 ou predicates legacy;
- V2 como default global;
- novo capability ou intelligence behavior;
- novo dashboard, UI, Inbox, CRM ou observability stack;
- novo worker, queue, booking, outbox, sender ou Lab schema;
- persona engine genérico;
- framework de avaliação ou simulação;
- usar authority Internal Lab como customer production authority.

O primeiro cliente externo continua bloqueado pelos dois reviewers humanos distintos/calibrados,
owner review do Lab, regressões resolvidas e uma authority externa apropriada. Quando autorizado,
ele pode receber 100% V2 tenant-scoped desde a primeira mensagem, sem rollout percentual, mas com
feature flag, observabilidade, V1 e rollback preservados.
