# Runtime conversacional V2-only — rollout e rollback

Este é o procedimento canônico para retirar a seleção de engine do caminho produtivo e operar a
V2 como runtime definitivo. V1, approvals por build, shadow comparativo e artefatos do Cycle I são
evidência histórica: nenhum deles autoriza atendimento ou serve como fallback.

Primeiro corte autorizado:

- tenant: **SystemOps Dental Lab**;
- UUID: `92fe7ecf-f383-4ddc-8c4e-53271af8e3a0`;
- actor: `Brendon Walefy`;
- authority exigida: version 2.

Os comandos não carregam `.env.local`. A operação usa um shell protegido com `DATABASE_URL`
explicitamente autorizado. Nunca imprima URL, credencial, telefone, corpo ou payload.

## Invariantes

- Todo turno live usa V2; nenhum erro chama V1.
- Automação live exige `conversation_authority.version >= 2`.
- Automação live exige também `organizations.live_automation_enabled=true` para o tenant exato;
  a flag não seleciona engine, não expira por build e nasce `false`.
- Linha ausente, leitura inconclusiva ou kill switch ausente/fechado é fail-closed.
- A criação da outbox e o sender revalidam tenant, stream, geração, inbound, claim job e token.
- O sender também relê status ativo, auto-reply, shadow/observe, takeover, consentimento/opt-out,
  safety gates e kill switch imediatamente antes do provider.
- Pausados, desabilitados, demo, prospect e tenants sem authority V2 não são alterados pelo deploy.
- Retry conserva a mesma authority e dedupe: até 3 claims de `message.process` e 10 de
  `message.send`; o terminal é resposta segura única, handoff, `sent`, `cancelled` ou `dead`.
- Não existe polling, heartbeat ou novo worker contínuo neste corte.

## Stop conditions

Pare antes da próxima escrita se o live set não for exatamente o revisado, authority tiver métrica
bloqueante, houver job pending/processing/failed/locked (incluindo jobs do sender) ou outbound
pending/processing/failed, compare-and-set falhar, digest dos outros
tenants mudar, migration divergir da gerada/revisada, SHA implantado não for o esperado, worker
antigo permanecer ativo, teste indicar duplicação real ou qualquer provider for chamado com o
switch fechado.

## Comandos

Auditoria inicial, read-only. No primeiro corte real o Lab ainda está em `operational_status=test`
e pode responder somente pelo binding histórico do build anterior; portanto o conjunto de tenants
com `operational_status=active` deve estar vazio. A auditoria ainda exige o UUID exato do Lab,
`is_test=true`, authority 2 e todos os demais gates limpos:

```bash
npm run v2:rollout:audit -- \
  --clinic-id 92fe7ecf-f383-4ddc-8c4e-53271af8e3a0 \
  --expect-no-live-tenants
```

Controle de status é dry-run por padrão:

```bash
npm run v2:rollout:control -- \
  --clinic-id 92fe7ecf-f383-4ddc-8c4e-53271af8e3a0 \
  --actor "Brendon Walefy" \
  --action tenant-status \
  --expected-status test \
  --next-status paused
```

Controle global também é dry-run por padrão e exige a versão lida na auditoria:

```bash
npm run v2:rollout:control -- \
  --clinic-id 92fe7ecf-f383-4ddc-8c4e-53271af8e3a0 \
  --actor "Brendon Walefy" \
  --action global-control \
  --expected-control-version "$EXPECTED_CONTROL_VERSION" \
  --live-outbound-enabled false
```

Somente depois de revisar a saída idêntica, repita o comando exato com `--apply`. Cada apply altera
no máximo uma linha: a linha exata do Lab ou o singleton global. O resultado inclui actor, estado
persistido, affectedRows e prova de zero mudança nos demais tenants.

## Primeiro corte

### 1. Validar o candidato

Exija PR para `develop`, release PR para `main`, CI, Migration CI e preview verdes. Em banco
descartável, aplique migrations do zero e de um snapshot até a migration anterior. Confirme que o
SQL é gerado pelo Drizzle e não destrutivo.

Rode os gates locais do plano: suites V2, authority PostgreSQL sem skips, schema, `npm run verify`,
build limpo e medição de performance. Nenhum gate local autoriza escrita produtiva.

### 2. Auditar e pausar somente o Lab

Execute a auditoria inicial. Exija status `test`, `is_test=true`, authority 2, métricas bloqueantes
zero, filas/outbounds ativos zero e conjunto `operational_status=active` vazio. Registre o digest
dos outros tenants e a versão do controle global.

Faça dry-run e apply de `test -> paused` com o comando acima. O controle rejeita `test -> active`:
o fence intermediário não pode ser pulado. Antes da migration aditiva, o
comando usa compare-and-set somente do status; depois dela, status e permissão live fecham juntos.
Repita a auditoria com:

```bash
npm run v2:rollout:audit -- \
  --clinic-id 92fe7ecf-f383-4ddc-8c4e-53271af8e3a0 \
  --expect-no-live-tenants
```

Exija live set vazio e o mesmo digest dos outros tenants.

### 3. Fechar o kill switch e drenar

Se o singleton já existir e estiver aberto, faça dry-run e apply para
`liveOutboundEnabled=false` usando a versão exata. Se a tabela ainda não existir, a auditoria a
representa como fechada/version 0 e nenhuma escrita é necessária. Drene
workers de processo e sender pelos endpoints one-shot canônicos; não introduza polling. Exija zero
jobs pending/processing/failed/locked para o Lab (incluindo jobs do sender), outbounds
pending/processing/failed e nenhum job produtivo pendente global.

### 4. Implantar V2-only e provar isolamento de builds antigos

Promova somente o SHA revisado. Mantenha Lab pausado e switch fechado. A migration gerada adiciona
o singleton global fail-closed e `live_automation_enabled default false`; portanto nenhum tenant é
ativado pela expansão. Confirme Vercel `READY`, alias de produção no SHA exato e migrations aplicadas.

Espere invocações antigas encerrarem. Confirme que endpoints de wake resolvem para o novo deploy e
que nenhum worker/build anterior mantém lease, cria outbox ou processa novo fluxo. O primeiro corte
não possui build V2-only anterior estável: rollback aqui é switch fechado, Lab pausado, handoff e
correção forward.

### 5. Validar o candidato fechado

Com zero provider calls, prove:

- composição produtiva alcança somente `V2LiveConversationHandler`;
- não existe import transitivo de V1/router/approval nos roots live;
- readiness lê authority 2, configuração atual, canal conectado e switch fechado;
- criação de `live_stream_reply` e sender preflight falham por kill switch;
- authority validation permanece limpa;
- nenhum outro tenant mudou.

### 6. Abrir e reativar somente o Lab

Faça dry-run e apply do singleton `false -> true` com compare-and-set da versão atual. Em seguida,
faça dry-run e apply do Lab `paused -> active`. O mesmo CAS habilita
`live_automation_enabled=true` somente nessa linha. A reativação falha se authority for menor que
2, `isTest` for falso, demo estiver ligado, auto-reply estiver desligado ou shadow estiver ligado.
Uma transação HTTP não interativa curta bloqueia mudanças concorrentes de tenant, authority, job e
outbound até o commit; nenhum outro tenant recebe a permissão.

Repita readiness remoto e auditoria inicial. Exija live set exatamente `[SystemOpsLab]`, switch
aberto, authority 2, canal conectado, métricas bloqueantes zero e digest dos demais tenants
inalterado.

### 7. Um smoke real

Peça ao owner uma única mensagem real; não gere mensagem sintética. Usando somente metadata e
horários, exija:

- webhook recebido;
- um inbound no stream/generation correto;
- um claim durável;
- `automationMode=live`;
- uma outbox `live_stream_reply` com a tuple exata;
- sender preflight autorizado;
- um único `sent` e nenhuma duplicação/erro/job pendente;
- métricas bloqueantes da authority 2 em zero;
- latência dentro do gate aprovado.

### 8. Observar e fechar

Observe por 30 minutos queue age, authorization rejections, provider errors, handoff rate, lock
wait, model calls/tokens e compute-active do Neon. Registre SHA, versão do controle, status/authority
do Lab, latência do smoke e confirmação de zero alterações em outros tenants.

## Gates mensuráveis de performance

O baseline congelado está em `evals/v2-only/runtime-baseline.json` e usa 17 casos × 6 repetições,
102 turnos por braço. O candidato precisa manter cardinalidade exata: um event e um process job por
turno, no máximo um live reply e um send job por reply.

Limites do avaliador. Todo custo candidato é comparado diretamente ao braço V2 congelado; V1
permanece no mesmo relatório somente como referência histórica, nunca como runtime, fallback ou
normalizador capaz de autorizar regressão:

- latência V2 p50/p95: até +10% e crescimento absoluto de até +100 ms/+250 ms;
- chamadas ao modelo V2: média e p95 não podem aumentar sobre a V2 congelada;
- tokens V2: média até +10%, p95 até +15% sobre a V2 congelada;
- statements V2 p95 até +10%; round trips V2 p95 até +2 sobre a V2 congelada;
- lock hold V2: até +10% e crescimento absoluto de até +5 ms;
- concorrência por stream repetida 50 vezes, sem geração duplicada ou bloqueio cross-stream;
- idle Neon: mesma contagem de wakes/SQL do baseline em duas janelas de 30 minutos e no máximo
  +5 segundos de compute-active. Use somente branch descartável autorizada.

Comando:

```bash
npm run measure:v2-only-runtime -- --baseline evals/v2-only/runtime-baseline.json
```

## Rollback

Ao primeiro sinal de regressão: feche o kill switch por compare-and-set, pause somente o Lab,
preserve inbox/outbox e faça handoff. Não apague eventos, não recrie outbounds e não mude authority.
Prepare correção forward. Redeploy de um build V2-only estável só se torna opção depois que o
primeiro release V2-only permanecer saudável e for registrado. V1 nunca é rollback.

Depois do primeiro release, futuras ativações continuam tenant-scoped, com validação limpa e
compare-and-set monotônico. Deploy por si só não ativa tenant algum.
