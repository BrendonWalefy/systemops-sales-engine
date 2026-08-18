# SystemOps Lab — canal e configuração odontológica controlados

Este procedimento é exclusivamente para o ambiente **SystemOps Lab**. Não copie ou reutilize contatos de clientes, calendários reais, mídia ou corpos de conversa neste ambiente. A transferência é uma mudança controlada: nenhum comando `apply` é autorizado sem credencial rotacionada, aprovação da mudança e todos os gates abaixo aprovados.

A configuração odontológica deste runbook é inteiramente sintética e usa somente
`organizations`, `professionals`, `treatments` e `playbook_versions`. Ela não cria
schema, Lab, Inbox, worker, fila, outbox, sender ou dashboard. O resultado formal
do Cycle I permanece inalterado, com o critério qualitativo
`not_measurable`/`pending_human_review`; a authority Internal Lab não muda esse
estado e nunca autoriza tenant externo.

## Stop conditions

Pare imediatamente se o destino não for visualmente identificado como Lab, se `isTest=true` não estiver confirmado, se a organização for demo, se `operationalStatus` não for `test`, se `autoReplyEnabled` ou `shadowModeEnabled` estiverem ligados, se o source/target observado diferir do esperado, se não houver token comprovadamente rotacionado, ou se qualquer verificação retornar bloqueadores. Não envie mensagens, não habilite automação e não prossiga por tentativa e erro.

## Como ler este runbook

As seções 1–12 preparam o canal e a configuração odontológica. As seções 13–25
executam a ativação da Conversation Intelligence V2 no Lab e só começam depois de
a branch estar mergeada e promovida pelo change control normal.

Os comandos `npm run lab:*` operam sobre o banco onde o Lab vive e não carregam
`.env.local` sozinhos: exporte `DATABASE_URL` e as demais variáveis exigidas no
shell protegido, ou prefixe a chamada com `npx dotenv -e .env.local --`, como nas
seções 4 e 7. Esse prefixo é legítimo aqui porque a operação é deliberada e
tenant-scoped. Ele nunca vale para `npm run verify` nem para testes, que rodam
sem banco por decisão de segurança.

Cada seção declara:

- **Precondition** — o que precisa estar comprovado antes do comando.
- **Comando** — a invocação exata, sem segredos.
- **Expected** — a decisão esperada na saída.
- **Retorna a V1 se** — a condição que interrompe a ativação e devolve o Lab à V1
  no turno seguinte.

Gates que este runbook não executa sozinho:

| Gate | Tipo | Autoridade |
| --- | --- | --- |
| aprovação do PR para `develop` | HUMAN | revisor humano |
| promoção `develop -> main` | HUMAN | owner |
| conversa pelo WhatsApp real do owner | HUMAN | owner |
| owner review dos transcripts | HUMAN | owner |
| CI e preview | PLATFORM | GitHub Actions / Vercel |
| deploy e variáveis protegidas | PLATFORM | Vercel |
| execução dos crons e da fila durável | PLATFORM | Vercel Cron |
| leitura/escrita no banco | PLATFORM | Neon |
| entrega real de mensagem | PLATFORM | Z-API |

Nenhum desses gates pode ser marcado como concluído por simulação, e nenhum deles
é substituído por teste verde.

## 1. Rotate the exposed token in Z-API

Rotacione o token exposto diretamente no painel da Z-API. Registre apenas a evidência de rotação no ticket de mudança; nunca registre ou cole o valor do token em chat, ticket, shell history ou git.

## 2. Create or verify SystemOps Lab with automation off

Crie ou confira a organização Lab com uma etiqueta visual inequívoca de **SystemOps Lab**, `isTest=true`, `isDemo=false`, status operacional `test`, `autoReplyEnabled=false` e `shadowModeEnabled=false`. Exija agenda interna sintética e números de contato SystemOps controlados. Não importe dados, calendário, mídia ou conversas de clientes reais.

## 3. Export rotated credentials locally without pasting them in chat or git

Em uma sessão local protegida, exporte os valores rotacionados somente em `.env.local`, sem commit. Confirme os IDs de source e target no ticket de mudança. O token precisa ter sido rotacionado antes desta etapa e a aprovação de mudança deve estar registrada.

## 4. Run the dry-run

```bash
npx dotenv -e .env.local -- npx tsx scripts/transfer-systemops-lab-channel.ts
```

O dry-run é obrigatório e não transfere nada. Interrompa caso o relatório não mostre o destino, source esperado e automação desligada.

## 5. Review the expected source and target IDs

Faça revisão humana de quatro olhos do ID do Lab, do ID do source esperado, do `instanceId` e da saída do dry-run. Confirme que a credencial rotacionada está apenas no ambiente local e que os gates de mudança foram aprovados. Não avance com IDs inferidos ou discrepantes.

## 6. Apply the transfer

Somente após rotação do token, gates de mudança aprovados e revisão do dry-run, execute uma única vez:

```bash
SYSTEMOPS_LAB_APPLY=true SYSTEMOPS_LAB_TRANSFER_CONFIRMATION=TRANSFER_ROTATED_CREDENTIAL_TO_SYSTEMOPS_LAB npx dotenv -e .env.local -- npx tsx scripts/transfer-systemops-lab-channel.ts
```

Este é o único comando mutável do procedimento. Ele exige a confirmação literal e o token local rotacionado; se qualquer gate falhar, pare e abra incidente. Não habilite automação depois da transferência.

## 7. Run local and remote readiness verification

```bash
npx dotenv -e .env.local -- npx tsx scripts/verify-systemops-lab.ts
SYSTEMOPS_LAB_CHECK_REMOTE=true npx dotenv -e .env.local -- npx tsx scripts/verify-systemops-lab.ts
```

O primeiro check é local e read-only; `remote_not_connected` nele é aviso porque a consulta remota não foi solicitada. O segundo também é read-only, consulta somente o status da instância e deve retornar conexão ativa. As saídas são JSON e não exibem segredos, apenas `configured: true|false`.

Se o verificador não puder concluir uma leitura local, ele ainda retorna JSON sanitizado com o único reason code operacional allowlisted `readiness_check_failed`; não use mensagens de banco, rede ou provider como reason code e não as registre com credenciais.

## 8. Dry-run da configuração declarativa

Use o ID exato do Lab, o `channelDigest` e o digest da lista exata de memberships
`owner`, mantidos na configuração protegida da mudança. Não use nome parcial para
descobrir tenant. O dry-run é read-only e pode escrever o artifact
projetado somente em arquivo absoluto, fora do worktree, com permissão de owner:

```bash
npm run lab:config -- \
  --clinic-id "$SYSTEMOPS_LAB_CLINIC_ID" \
  --expected-channel-digest "$CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST" \
  --expected-owner-membership-digest "$SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST" \
  --dry-run \
  --resolved-artifact-file /caminho/protegido/systemops-lab-resolved.json
```

A saída contém somente modo, ID, digests, contagens/razões e confirmação de que o
artifact protegido foi escrito. O arquivo resolvido contém apenas presença e
digests unidirecionais das credenciais de canal, nunca os bytes de token; ainda
assim, só deve ser entregue ao `lab:sign-approval` e nunca impresso, anexado ou
adicionado ao Git. O `desiredConfigDigest` confirma o JSON declarativo. Os bindings
`tenantDigest`, `channelDigest` e `configDigest` vêm exclusivamente do contrato de
runtime do Task 6 e são os usados pela approval.

Pare se houver mais de um candidato, predicates diferentes de `isTest=true`,
`isDemo=false`, `operationalStatus=test`, digest de canal ou membership owner
divergente, campanha de preço ativa ou conteúdo não sintético. O dry-run não lê
outro tenant como fonte de conteúdo.

## 9. Apply idempotente com snapshot externo

O apply exige confirmação do ID, digest de canal e membership owner exata. Antes
da primeira write ele cria, com `create-exclusive` e modo `0600`, um snapshot explícito fora
do repositório. Se o arquivo já existir, o comando falha; escolha um novo caminho
imutável em vez de sobrescrever evidência.

```bash
npm run lab:config -- \
  --clinic-id "$SYSTEMOPS_LAB_CLINIC_ID" \
  --expected-channel-digest "$CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST" \
  --expected-owner-membership-digest "$SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST" \
  --apply \
  --snapshot-file /caminho/protegido/systemops-lab-before-config.json \
  --resolved-artifact-file /caminho/protegido/systemops-lab-after-config.json
```

As mudanças ocorrem em uma transação, bloqueiam o tenant exato, revalidam o
snapshot após o lock e fazem upsert por identidade exata. O apply não altera
`autoReplyEnabled`, `shadowModeEnabled` ou `conversationEngine`. Rodá-lo novamente
mantém três treatments, um profissional sintético com o nome canônico e um único
playbook ativo canônico, sem duplicação.

## 10. Verify e bindings para a approval

```bash
npm run lab:config -- \
  --clinic-id "$SYSTEMOPS_LAB_CLINIC_ID" \
  --expected-channel-digest "$CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST" \
  --expected-owner-membership-digest "$SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST" \
  --verify \
  --resolved-artifact-file /caminho/protegido/systemops-lab-verified.json
```

`--verify` é read-only e falha se organização, agenda interna, horário, endereço
fictício, profissional, treatments/preços ou playbook ativo divergirem. O signer
recalcula os mesmos bindings a partir de `--resolved-artifact-file`; o digest
declarativo nunca é aceito no lugar do `configDigest` real.

Este artifact confirma a configuração, mas ainda não é o que a approval usa: os
digests só ficam definitivos depois que engine e automação assumem o estado final.
A captura autoritativa é a da seção 18.

## 11. Readiness por fase

Todas as fases exigem que a membership `owner` resolvida tenha o digest exato
`SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST`. `preactivation` exige automação desligada
e `conversationEngine=v1` e não exige approval. `smoke` exige automação ligada,
`v2_internal`, config digest exato e
approval registrada `INTERNAL_LAB_SMOKE_AUTHORIZED`. `ready` exige as mesmas
invariantes com `INTERNAL_LAB_READY`. Nenhuma fase consulta ou promove human review.

```bash
SYSTEMOPS_LAB_READINESS_PHASE=preactivation npm run lab:verify
SYSTEMOPS_LAB_READINESS_PHASE=smoke SYSTEMOPS_LAB_CHECK_REMOTE=true npm run lab:verify
SYSTEMOPS_LAB_READINESS_PHASE=ready SYSTEMOPS_LAB_CHECK_REMOTE=true npm run lab:verify
```

Nos modos `smoke` e `ready`, approval ausente, expirada, vinculada a outros bytes,
tenant/canal/config divergente ou decisão errada bloqueia automação. Estes comandos
rodam localmente e leem o shell local, não a plataforma: exporte neles exatamente
as variáveis listadas na seção 21 e nunca a private key.

## 12. Send no message until the Internal Lab smoke gate

Não envie, responda, dispare teste, campanha ou automação enquanto o readiness
`preactivation` estiver ativo. A ativação interna só ocorre com approval SMOKE
válida e continua restrita ao SystemOps Lab. Os dois reviewers humanos calibrados
continuam obrigatórios antes do primeiro cliente externo, não antes do Lab interno.

## 13. Sequência canônica de ativação da V2 no Lab

A ordem de execução não é a ordem de leitura do arquivo. Execute exatamente assim:

1. change control completo — seção 14;
2. chaves da authority interna fora do repositório — seção 15;
3. deploy do build aprovado com todos os tenants em V1 — seção 16;
4. dry-run, apply e verify da configuração odontológica — seções 8, 9 e 10;
5. estado final de ativação do Lab, ainda fail-closed em V1 — seção 17;
6. captura dos bindings sobre o estado final — seção 18;
7. medição final do Cycle I nos bytes implantados — seção 19;
8. emissão de `INTERNAL_LAB_SMOKE_AUTHORIZED` — seção 20;
9. publicação das variáveis protegidas e readiness `smoke` — seção 21;
10. smoke pelo número real do owner — seção 22;
11. prova de rollback `V2 -> V1 -> V2` — seção 23;
12. personas sintéticas, evidence e Inbox — seção 24;
13. emissão de `INTERNAL_LAB_READY` e estado final — seção 25.

O estado de ativação vem antes da captura dos digests porque `conversationEngine`
e `autoReplyEnabled` fazem parte da linha da organização que origina
`tenantDigest` e `configDigest`. Uma approval assinada antes da troca fica
vinculada à linha antiga e o runtime, que recalcula os bindings a cada turno,
recusaria a approval e manteria o Lab em V1 para sempre. Entre as seções 17 e 21
o Lab fica com engine `v2_internal` e sem approval válida: isso é fail-closed
correto — a V1 responde normalmente e nenhum efeito V2 acontece.

Qualquer falha interrompe a sequência no ponto em que ocorreu, devolve o Lab a V1
para o turno seguinte e mantém todos os demais tenants em V1.

## 14. Change control antes de qualquer ativação

**Precondition:** branch focada, árvore limpa e nenhum segredo no worktree.

```bash
git status --short
git rev-parse HEAD
git rev-parse HEAD^{tree}
npm run verify
npm test -- src/__tests__/SlotEngine.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/SlotDayPreference.test.ts src/__tests__/ClinicTimezone.test.ts
```

**Expected:** `git status --short` sem saída, `npm run verify` verde e os quatro
testes de agenda verdes. Rode `npm run verify` exatamente assim; nunca o envolva
com `dotenv` ou `.env.local`, conforme
[test-database-safety.md](test-database-safety.md).

Depois disso: push da branch, PR para `develop` (HUMAN), CI e preview verdes
(PLATFORM), merge em `develop` (HUMAN) e promoção aprovada `develop -> main`
(HUMAN). Nunca faça push direto em `main`, como exige
[change-control.md](change-control.md).

**Retorna a V1 se:** qualquer verificação falhar, qualquer commit novo entrar
depois da medição ou a promoção não for aprovada. Um commit novo invalida as
attestations e obriga a repetir as seções 19 e 20.

## 15. Chaves da authority Internal Lab fora do repositório

**Precondition:** sessão local protegida, diretório fora do worktree e umask que
produza permissão apenas do owner.

A authority Internal Lab é Ed25519 e é distinta das roots de gate report, de
activation approval e de replay. Gere o par fora do repositório, mantenha o
arquivo privado com permissão `0600` e um único link, e publique somente a public
key em `CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY`.

**Expected:** private key existente apenas no diretório protegido local; public
key presente somente na configuração da plataforma e do shell de assinatura.

**Retorna a V1 se:** a private key aparecer no worktree, em log, em artifact, em
chat, no banco ou na plataforma. Nesse caso rotacione a authority antes de
continuar; o signer recusa arquivo com permissão frouxa, symlink, hard link ou
caminho dentro do repositório.

## 16. Deploy do build aprovado com todos os tenants em V1

**Precondition:** `main` promovida e CI verde.

O deploy é gate PLATFORM. Ele acontece antes da approval porque a approval
precisa citar o commit efetivamente implantado.

**Expected:** o build sobe com todos os tenants ainda em `v1`; a plataforma
reporta `VERCEL_GIT_COMMIT_SHA` igual ao commit promovido. Nenhum tenant muda de
comportamento: `v2_internal` continua inalcançável enquanto não houver approval.

**Retorna a V1 se:** o commit implantado divergir do commit promovido. Sem ativar
nada, corrija o deploy antes de continuar.

## 17. Estado final de ativação do Lab, ainda fail-closed em V1

**Precondition:** seções 9, 10 e 16 concluídas; readiness `preactivation` verde.

Não existe — e não deve ser criada — uma tela ou script de ativação. As duas
mudanças de estado são controladas e feitas pelo owner sobre o ID exato do Lab
(gate PLATFORM sobre o banco de produção), em uma transação com verificação
explícita de linhas afetadas:

```sql
BEGIN;
UPDATE organizations
   SET conversation_engine = 'v2_internal', auto_reply_enabled = true
 WHERE id = :systemops_lab_clinic_id
   AND is_test = true
   AND is_demo = false
   AND operational_status = 'test';
-- confirme que exatamente 1 linha foi afetada antes de seguir
COMMIT;   -- ou ROLLBACK; se o contador divergir
```

`auto_reply_enabled` precisa ficar ligado aqui: o readiness das fases `smoke` e
`ready` bloqueia com `automation_must_be_enabled` enquanto a automação estiver
desligada, e o valor participa dos digests capturados na seção 18.

**Expected:** exatamente uma linha afetada. O Lab passa a ter engine
`v2_internal` sem approval registrada, portanto o router falha fechado e a V1
continua respondendo. Nenhum outro tenant é tocado.

**Retorna a V1 se:** o contador de linhas divergir de 1, o `WHERE` atingir
qualquer ID que não seja o do Lab, ou algum predicate de teste não bater. O
rollback é o mesmo `UPDATE` com `'v1'` e `auto_reply_enabled = false`, e passa a
valer no turno seguinte.

## 18. Captura dos bindings sobre o estado final

**Precondition:** seção 17 concluída, com engine e automação já no estado final.

Repita o `--verify` da seção 10 agora, para que o artifact resolvido reflita a
linha definitiva da organização:

```bash
npm run lab:config -- --clinic-id "$SYSTEMOPS_LAB_CLINIC_ID" --expected-channel-digest "$CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST" --expected-owner-membership-digest "$SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST" --verify --resolved-artifact-file /caminho/protegido/systemops-lab-activated.json
```

**Expected:** `tenantDigest`, `channelDigest` e `configDigest` calculados sobre a
organização já em `v2_internal` com automação ligada. Esses são os valores usados
nas claims e nas variáveis protegidas.

**Retorna a V1 se:** o verify recusar organização, agenda interna, horário,
endereço fictício, profissional, treatments/preços ou playbook ativo. Corrija a
configuração e recapture antes de assinar qualquer coisa.

## 19. Medição final do Cycle I nos bytes implantados

**Precondition:** repositório local no commit exato implantado, árvore limpa,
manifest e chaves dedicadas fora do repositório, `OPENAI_API_KEY` disponível
apenas no ambiente local protegido.

```bash
npm run eval:conversation-v2:cycle-i -- --mode measure --out /caminho/protegido/cycle-i-run.json --run-manifest evals/cycle-i/run-manifest.json
npm run eval:conversation-v2:cycle-i -- --mode evaluate-gates --run /caminho/protegido/cycle-i-run.json --out /caminho/protegido/cycle-i-gate-report.json
```

**Expected:** o gate report final continua com decisão `NO_GO` e o critério
qualitativo em `not_measurable` ou `pending_human_review`. Esse é o resultado
correto: os dois reviewers humanos distintos e calibrados ainda não existem e
nenhuma authority local promove esse estado para `PASS`.

**Retorna a V1 se:** o report não puder ser gerado sobre os bytes exatos
implantados, ou se alguém tentar reinterpretar `NO_GO` como aprovação. A
authority Internal Lab autoriza apenas dogfooding interno e nunca tenant externo.

## 20. Emitir `INTERNAL_LAB_SMOKE_AUTHORIZED`

**Precondition:** seções 14 a 19 concluídas; artifact resolvido da seção 18
guardado fora do repositório com permissão de owner; repositório local no commit
implantado e com árvore limpa.

O signer valida authority e build no próprio processo, então o shell de
assinatura precisa exportar exatamente:
`CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY`,
`CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST`,
`CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST`,
`CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST`,
`CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY`,
`CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY`,
`CONVERSATION_V2_GATE_REPORT_DIGEST`, `CONVERSATION_V2_POPULATION_DIGEST`,
`CONVERSATION_V2_DATASET_DIGEST`, `CONVERSATION_V2_CONFIG_DIGEST` e
`VERCEL_GIT_COMMIT_SHA` com o SHA completo de 40 caracteres do commit implantado.
Use `VERCEL_GIT_COMMIT_SHA` também aqui, e não `GIT_COMMIT_SHA`: o mesmo shell
serve à seção 21, que exige essa variável, e definir as duas com valores
diferentes é recusado. SHA abreviado assina nesta seção e falha na seguinte. Nenhuma
dessas variáveis é secreta; a private key entra somente por
`--private-key-file`.

O arquivo de claims é montado à mão, fora do repositório, com os valores exatos
já obtidos: `commitSha`, `treeSha`, `sourceDigest` e `runtimeDigest` do build;
`tenantDigest`, `channelDigest` e `configDigest` da seção 18; `cycleIGateDigest`
do report da seção 19; `cycleIDecision` igual a `NO_GO`; `qualitativeStatus`
igual a `not_measurable` ou `pending_human_review`; e `expiresAt` com janela
curta.

`criteria` é uma lista ordenada e exata. Para SMOKE, nesta ordem:
`h_safety_entailment_preserved`, `tasks_1_7_closed`, `architecture_review_clear`,
`final_build_measurement_recorded`, `single_router_boundary`,
`tenant_flag_fail_closed`, `same_turn_fallback_absent`,
`isolation_dedupe_state_booking_outbox_sender_green`,
`bidirectional_rollback_green`, `verify_green` e `single_internal_target`.

`evidenceDigests` também é ordenada e exata: `verification` e depois
`architecture_review`.

```bash
npm run lab:sign-approval -- --private-key-file /caminho/protegido/internal-lab-authority.pem --claims-file /caminho/protegido/internal-lab-smoke-claims.json --resolved-artifact-file /caminho/protegido/systemops-lab-activated.json --output /caminho/protegido/internal-lab-smoke-approval.json
```

**Expected:** approval assinada gravada com modo `0600` e recusa de sobrescrita.
O signer só assina se as claims baterem com o build Git registrado, com o runtime
configurado e com os bindings do artifact resolvido.

**Retorna a V1 se:** build, tree, runtime, tenant, canal ou config divergirem; se
a janela de expiração vencer; ou se a decisão pedida não for
`INTERNAL_LAB_SMOKE_AUTHORIZED`. Emita uma nova approval a partir dos bytes reais
em vez de ajustar as claims.

## 21. Publicar as variáveis protegidas e verificar o readiness `smoke`

**Precondition:** seção 20 concluída.

Configure na plataforma, como variáveis protegidas,
`SYSTEMOPS_LAB_CLINIC_ID`,
`CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY`,
`CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON`,
`CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST`,
`CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST`,
`CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST`,
`CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY`,
`CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY`,
`CONVERSATION_V2_GATE_REPORT_DIGEST`, `CONVERSATION_V2_POPULATION_DIGEST`,
`CONVERSATION_V2_DATASET_DIGEST` e `CONVERSATION_V2_CONFIG_DIGEST`. Nunca envie
private key ao runtime.

`SYSTEMOPS_LAB_CLINIC_ID` é obrigatória e não tem substituto: sem ela o runtime
assume um alvo inexistente e o router recusa o Lab silenciosamente, mantendo a V1
sem emitir reason code novo.

Em seguida faça um redeploy PLATFORM do mesmo commit para que o runtime leia as
variáveis. O readiness roda localmente e lê o shell local, não a plataforma;
exporte nele `DATABASE_URL`, `SYSTEMOPS_LAB_CLINIC_ID`,
`SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST`, `ZAPI_WEBHOOK_SECRET`,
`CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON` com os bytes exatos publicados, as
mesmas variáveis listadas acima e `VERCEL_GIT_COMMIT_SHA` com o SHA completo de 40
caracteres do commit implantado — essa é a única forma aceita do commit aqui,
abreviação é recusada, e definir também `GIT_COMMIT_SHA` com outro valor é
recusado.

```bash
SYSTEMOPS_LAB_READINESS_PHASE=smoke SYSTEMOPS_LAB_CHECK_REMOTE=true npm run lab:verify
```

**Expected:** readiness `smoke` verde, com automação ligada, `v2_internal`, config
digest exato e approval `INTERNAL_LAB_SMOKE_AUTHORIZED` registrada. A partir deste
ponto o Lab responde pela V2.

**Retorna a V1 se:** o readiness recusar approval ausente, expirada, vinculada a
outros bytes ou com tenant/canal/config divergente; se o commit do redeploy
divergir do commit da approval; ou se faltar qualquer variável do shell de
readiness — approval JSON, webhook secret, raízes de authority ou commit. Todas
essas causas chegam ao relatório como o mesmo `approval_missing_or_invalid`, então
confira as listas acima antes de suspeitar do artifact.

Um readiness verde não prova que a plataforma está completa: o verificador usa o
próprio `--clinic-id` como alvo esperado, enquanto o runtime usa
`SYSTEMOPS_LAB_CLINIC_ID` da plataforma. Se a seção 22 mostrar trace de V1 com
readiness verde, a causa é essa variável ausente no deploy — verifique-a antes de
investigar approval, digests ou canal.

## 21-A. Todo deploy invalida a approval

**Precondition:** qualquer deploy novo em produção, inclusive redeploy que troque o commit.

A approval é vinculada ao commit exato (`claims.commitSha` contra
`deploymentIdentity.commit`). Um deploy novo muda o commit e a approval deixa de
valer. Como o Lab tem `operationalStatus=test`, a automação só é concedida pela
exceção que a approval sustenta: sem ela o turno não vira resposta e o trace
mostra `engine.selected` com `reason: "automation_not_live"`.

**Expected:** depois de cada deploy, repetir as seções 18, 20 e 21 — recapturar
bindings, reassinar com o novo `commitSha`/`treeSha`/`sourceDigest` e republicar
`CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON`. Um redeploy do mesmo commit não
exige reassinatura.

**Retorna a V1 se:** o commit implantado divergir do commit das claims. É
silencioso: nenhum erro aparece, apenas o Lab para de responder. Ao investigar
ausência de resposta, confira este ponto antes de qualquer outra hipótese.

## 22. Smoke pelo número real do owner

**Precondition:** seção 21 verde.

Este é um gate HUMAN. O owner envia uma mensagem normal pelo próprio WhatsApp
para o número do Lab e aguarda a resposta pelo sender real. Esse caminho não usa
endereço sintético nem captura; ele atravessa o canal real já associado ao Lab.

**Expected:** resposta da V2 entregue pelo canal real e conversa completa visível
no Inbox atual, com o trace indicando a engine V2 no turno.

**Retorna a V1 se:** a resposta não chegar, chegar duplicada, vier de outro
tenant, alcançar qualquer contato que não seja o owner, ou se o trace indicar
engine diferente da esperada. Nenhum telefone ou transcript real entra em
artifact.

## 23. Prova de rollback `V2 -> V1 -> V2`

**Precondition:** seção 22 verde, mesma conversa do owner, três turnos distintos.

Execute na mesma conversa: turno A com o Lab em `v2_internal`; troque
`conversation_engine` para `'v1'` pela transação da seção 17 e envie o turno B;
volte para `'v2_internal'` e envie o turno C. Mantenha `auto_reply_enabled`
ligado nas três etapas — o campo participa dos digests, e voltar a engine para
`v2_internal` restaura exatamente a linha assinada. A troca de flag só vale para
turnos novos: não existe fallback `V2 -> V1` dentro do mesmo turno.

**Expected:** o trace mostra V2, V1 e V2 na ordem dos turnos; o mesmo
`conversation_states` sobrevive às trocas; dedupe por `messageId`/`turnId`
preservado; ordem da outbox durável preservada; nenhum inbound ou outbound
repetido; nenhum booking duplicado.

**Retorna a V1 se:** qualquer turno duplicar efeito, perder estado, reordenar a
outbox ou indicar que a V1 foi chamada dentro de um turno V2. Deixe o Lab em `v1`
e abra incidente antes de qualquer nova tentativa.

## 24. Personas sintéticas, evidence e Inbox

**Precondition:** seção 23 verde e Lab novamente em `v2_internal`. O shell precisa
de `DATABASE_URL`, `OPENAI_API_KEY`, `SYSTEMOPS_LAB_CLINIC_ID` igual ao
`--clinic-id`, e das mesmas variáveis `CONVERSATION_V2_INTERNAL_LAB_*` da seção
21 — o runner compara os bindings atuais com essa configuração antes de executar.

O `--run-id` é imutável por execução e o resultado protegido fica fora do
repositório. O dry-run não toca banco, fila nem canal:

```bash
npm run lab:personas -- --dry-run --run-id 2026-08-17-price-scheduling-01 --clinic-id "$SYSTEMOPS_LAB_CLINIC_ID" --persona evals/systemops-lab/personas/price-scheduling.json --approval-file /caminho/protegido/internal-lab-smoke-approval.json
npm run lab:personas -- --execute --run-id 2026-08-17-price-scheduling-01 --clinic-id "$SYSTEMOPS_LAB_CLINIC_ID" --persona evals/systemops-lab/personas/price-scheduling.json --approval-file /caminho/protegido/internal-lab-smoke-approval.json --result-file /caminho/protegido/systemops-lab-run.json
```

Repita para `evals/systemops-lab/personas/objection-escalation.json` e
`evals/systemops-lab/personas/booking-revalidation.json`, cada uma com o seu
próprio `--run-id` e o seu próprio arquivo de resultado.

Depois renderize a evidência sobre o resultado protegido:

```bash
npm run lab:evidence -- --run-file /caminho/protegido/systemops-lab-run.json --clinic-id "$SYSTEMOPS_LAB_CLINIC_ID" --output-root evals/systemops-lab
```

**Expected:** zero chamada ao provider de canal — as personas atravessam
persistence, fila, engine, outbox e sender reais, e só a fronteira de entrega é
capturada; a chamada ao provider de modelo é esperada e real. Cada inbound,
outbound e message fica persistido no tenant Lab, a conversa completa aparece no
Inbox atual e cada run produz exatamente `transcript.md`, `trace.json` e
`evaluation.json`, além de atualizar o `latest-summary.md` compartilhado. Todo
transcript termina com `OWNER REVIEW: PENDING`; o renderer recusa sobrescrever
evidência existente e bloqueia PII, secrets, URLs privadas e payload de provider.

**Retorna a V1 se:** qualquer endereço sintético alcançar o canal real, qualquer
run reutilizar um `--run-id`, o resultado protegido divergir da persistência, ou o
scanner de PII/secrets acusar qualquer ocorrência.

## 25. Emitir `INTERNAL_LAB_READY` e estado final

**Precondition:** seções 16 a 24 verdes, com evidência real para cada critério, e
o mesmo shell de assinatura descrito na seção 20.

As claims de READY repetem os bindings de build, tenant, canal e config da
seção 18 e usam `expiresAt` nulo. `criteria` mantém a ordem de SMOKE e acrescenta,
nesta ordem: `exact_build_deployed`, `real_internal_number_smoke_green`,
`production_rollback_green`, `inbox_persistence_green`,
`synthetic_personas_captured`, `automated_evidence_generated`,
`observability_green` e `lab_final_engine_v2_internal`. `evidenceDigests` também
é ordenada e exata: `verification`, `architecture_review`, `production_smoke`,
`rollback`, `personas`, `inbox` e `observability`, calculados sobre os bytes
finais.

```bash
npm run lab:sign-approval -- --private-key-file /caminho/protegido/internal-lab-authority.pem --claims-file /caminho/protegido/internal-lab-ready-claims.json --resolved-artifact-file /caminho/protegido/systemops-lab-activated.json --output /caminho/protegido/internal-lab-ready-approval.json
```

Publique a approval READY em `CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON`, faça o
redeploy PLATFORM do mesmo commit, mantenha `conversation_engine` em
`v2_internal` somente no Lab e repita o readiness remoto no mesmo shell descrito
na seção 21, com `CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON` já atualizado para
os bytes de READY:

```bash
SYSTEMOPS_LAB_READINESS_PHASE=ready SYSTEMOPS_LAB_CHECK_REMOTE=true npm run lab:verify
```

**Expected:** readiness `ready` verde e Lab em `v2_internal`. Entregue ao owner o
Inbox atual, a conversa do telefone real, os transcripts sintéticos e o processo
de revisão `APROVAR | RUIM | CRIAR REGRESSÃO`.

**Retorna a V1 se:** faltar evidência real para qualquer critério, se algum digest
não corresponder aos bytes finais, ou se surgir sinal de cross-tenant, envio a
contato não autorizado, efeito duplicado ou secret em artifact.

O owner review permanece `OWNER REVIEW: PENDING` até o próprio owner concluí-lo, e
feedback negativo vira corpus, teste de regressão e correção em mudança posterior
— nunca edição da evidência original. Os dois reviewers humanos distintos e
calibrados continuam obrigatórios antes do primeiro cliente externo, e o resultado
do Cycle I continua reportado honestamente.

## Rollback to a safe detached state

O rollback é somente detach: limpe o mapeamento de canal e as credenciais do Lab, mantenha todas as organizações com automação desabilitada e não reconecte o canal à Ximendes. Registre a hora, os IDs afetados e a evidência de que o Lab ficou destacado; trate qualquer próxima associação como uma nova mudança controlada.

Para reverter somente a configuração odontológica, primeiro retorne a engine a V1
para o turno seguinte e desligue a automação; depois use exatamente o snapshot
externo criado antes do apply:

```bash
npm run lab:config -- \
  --clinic-id "$SYSTEMOPS_LAB_CLINIC_ID" \
  --expected-channel-digest "$CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST" \
  --expected-owner-membership-digest "$SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST" \
  --rollback-snapshot /caminho/protegido/systemops-lab-before-config.json
```

O rollback revalida tenant e canal, executa em transação e confere o digest do
snapshot restaurado. Ele não transfere canal, não autoriza V2 e não deve ser usado
para copiar configuração entre tenants.

## Incident report fields

- ID do ticket de mudança e aprovadores.
- Horários (com timezone) de rotação, dry-run, apply, readiness e rollback.
- IDs de source, target e instância; nunca token, client token ou URL privada.
- Saídas JSON sanitizadas e reason codes.
- Estado de `isTest`, demo, status operacional, automação, shadow, resolução de tenant e conexão remota.
- Ação de detach executada, impacto conhecido e próximo responsável.
