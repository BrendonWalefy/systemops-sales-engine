# SystemOps Lab — transferência controlada de canal

Este procedimento é exclusivamente para o ambiente **SystemOps Lab**. Não copie ou reutilize contatos de clientes, calendários reais, mídia ou corpos de conversa neste ambiente. A transferência é uma mudança controlada: nenhum comando `apply` é autorizado sem credencial rotacionada, aprovação da mudança e todos os gates abaixo aprovados.

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

## 8. Send no message until the Phase 2 activation gate

Não envie, responda, dispare teste, campanha ou automação até o gate de ativação da Fase 2 estar formalmente aprovado. Mantenha `autoReplyEnabled=false` e `shadowModeEnabled=false`; a prontidão deste runbook autoriza apenas inbound controlado, nunca automação.

## Rollback to a safe detached state

O rollback é somente detach: limpe o mapeamento de canal e as credenciais do Lab, mantenha todas as organizações com automação desabilitada e não reconecte o canal à Ximendes. Registre a hora, os IDs afetados e a evidência de que o Lab ficou destacado; trate qualquer próxima associação como uma nova mudança controlada.

## Incident report fields

- ID do ticket de mudança e aprovadores.
- Horários (com timezone) de rotação, dry-run, apply, readiness e rollback.
- IDs de source, target e instância; nunca token, client token ou URL privada.
- Saídas JSON sanitizadas e reason codes.
- Estado de `isTest`, demo, status operacional, automação, shadow, resolução de tenant e conexão remota.
- Ação de detach executada, impacto conhecido e próximo responsável.
