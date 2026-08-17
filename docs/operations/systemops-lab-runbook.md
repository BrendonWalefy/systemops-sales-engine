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
tenant/canal/config divergente ou decisão errada bloqueia automação. Use sempre as
variáveis protegidas da plataforma; não passe private key ao runtime.

## 12. Send no message until the Internal Lab smoke gate

Não envie, responda, dispare teste, campanha ou automação enquanto o readiness
`preactivation` estiver ativo. A ativação interna só ocorre com approval SMOKE
válida e continua restrita ao SystemOps Lab. Os dois reviewers humanos calibrados
continuam obrigatórios antes do primeiro cliente externo, não antes do Lab interno.

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
