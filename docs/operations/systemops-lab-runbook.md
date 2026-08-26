# SystemOps Lab — canal, configuração e ferramentas offline

Este runbook cobre somente a configuração tenant-scoped do **SystemOps Dental Lab** e as
ferramentas offline de avaliação. A ativação produtiva segue exclusivamente o
[runbook V2-only](v2-only-runtime-rollout.md).

A V1, o selector de engine e approvals vinculadas ao build são referências históricas. Eles não
autorizam atendimento, não são fallback e não devem ser publicados para manter o Lab operante.

Tenant autorizado neste documento:

- UUID: `92fe7ecf-f383-4ddc-8c4e-53271af8e3a0`;
- classificação: tenant de teste não-demo;
- runtime live: somente V2, com authority version 2, permissão live tenant-scoped e kill switch;
- dados: exclusivamente contatos, agenda e configuração controlados pelo owner.

Nunca copie dados, credenciais, mensagens, telefones, calendários ou mídia de outro tenant.
`DATABASE_URL` deve ser fornecida por um shell operacional protegido; estes comandos não carregam
`.env.local` automaticamente.

## Stop conditions

Pare antes da próxima escrita se o UUID divergir, o diff incluir outro tenant, o snapshot não for
owner-only, o dry-run expandir além dos campos revisados, o compare-and-set falhar ou qualquer
saída contiver segredo/payload. A correção segura é fechar o kill switch, pausar somente o Lab e
corrigir forward; nunca redirecionar para V1.

Antes de qualquer operação, exija árvore limpa e o gate canônico verde:

```bash
npm run verify
```

## 1. Transferência controlada do canal

O transfer é dry-run por padrão e deve resolver source/target exatos sem imprimir credenciais:

```bash
npx tsx scripts/transfer-systemops-lab-channel.ts
```

Depois da revisão de quatro olhos, o apply usa somente as variáveis de confirmação já exigidas
pelo script e pelo shell protegido. Não publique seus valores e não use outro tenant.

```bash
SYSTEMOPS_LAB_APPLY=true SYSTEMOPS_LAB_TRANSFER_CONFIRMATION=TRANSFER_ROTATED_CREDENTIAL_TO_SYSTEMOPS_LAB npx tsx scripts/transfer-systemops-lab-channel.ts
```

Se a transferência precisar ser desfeita, use o procedimento de detach do próprio canal e preserve
os registros de auditoria. A transferência não habilita automação.

## 2. Readiness read-only

O verificador não aceita selector de fase ou approval. Ele comprova configuração atual, authority
V2, permissão tenant-scoped, controle global e conexão remota quando solicitada:

```bash
SYSTEMOPS_LAB_CLINIC_ID=92fe7ecf-f383-4ddc-8c4e-53271af8e3a0 npm run lab:verify
SYSTEMOPS_LAB_CLINIC_ID=92fe7ecf-f383-4ddc-8c4e-53271af8e3a0 SYSTEMOPS_LAB_CHECK_REMOTE=true npm run lab:verify
```

Readiness verde não ativa o tenant e não substitui os compare-and-set do rollout V2-only.

## 3. Configuração declarativa — dry-run

Use somente os digests revisados do canal e da membership owner. O artifact resolvido deve ficar
fora do worktree e não contém bytes de credencial:

```bash
npm run lab:config -- \
  --clinic-id 92fe7ecf-f383-4ddc-8c4e-53271af8e3a0 \
  --expected-channel-digest "reviewed-channel-digest" \
  --expected-owner-membership-digest "reviewed-owner-digest" \
  --dry-run \
  --resolved-artifact-file /private/tmp/systemops-lab-resolved.json
```

Exija que o diff esteja limitado aos campos revisados e que nenhuma organização, profissional,
canal ou playbook de outro tenant apareça.

## 4. Configuração declarativa — apply e verify

O apply é atômico, tenant-scoped e exige snapshot externo criado de forma exclusiva. Execute-o
somente após o dry-run correspondente:

```bash
npm run lab:config -- \
  --clinic-id 92fe7ecf-f383-4ddc-8c4e-53271af8e3a0 \
  --expected-channel-digest "reviewed-channel-digest" \
  --expected-owner-membership-digest "reviewed-owner-digest" \
  --apply \
  --snapshot-file /private/tmp/systemops-lab-before-config.json \
  --resolved-artifact-file /private/tmp/systemops-lab-after-config.json

npm run lab:config -- \
  --clinic-id 92fe7ecf-f383-4ddc-8c4e-53271af8e3a0 \
  --expected-channel-digest "reviewed-channel-digest" \
  --expected-owner-membership-digest "reviewed-owner-digest" \
  --verify \
  --resolved-artifact-file /private/tmp/systemops-lab-verified.json
```

O verify posterior deve reportar zero drift. Esse processo não altera status operacional,
`live_automation_enabled`, authority ou kill switch.

## 5. Rollback da configuração

O rollback usa exatamente o snapshot externo gerado antes do apply e permanece restrito ao UUID
do Lab:

```bash
npm run lab:config -- \
  --clinic-id 92fe7ecf-f383-4ddc-8c4e-53271af8e3a0 \
  --expected-channel-digest "reviewed-channel-digest" \
  --expected-owner-membership-digest "reviewed-owner-digest" \
  --rollback-snapshot /private/tmp/systemops-lab-before-config.json
```

Rollback de configuração não muda engine, não reativa automação e não restaura V1.

## 6. Personas e evidence offline

Personas sintéticas reutilizam os adapters de captura e nunca autorizam endereço real. O dry-run é
obrigatório; o execute grava somente o arquivo explícito e preserva dedupe do `run-id`:

```bash
npm run lab:personas -- --dry-run --run-id v2-price-scheduling-01 --clinic-id 92fe7ecf-f383-4ddc-8c4e-53271af8e3a0 --persona evals/systemops-lab/personas/price-scheduling.json
npm run lab:personas -- --execute --run-id v2-price-scheduling-01 --clinic-id 92fe7ecf-f383-4ddc-8c4e-53271af8e3a0 --persona evals/systemops-lab/personas/price-scheduling.json --result-file /private/tmp/systemops-lab-run.json
npm run lab:evidence -- --clinic-id 92fe7ecf-f383-4ddc-8c4e-53271af8e3a0 --run-file /private/tmp/systemops-lab-run.json --output-root /private/tmp/systemops-lab-evidence
```

Artifacts devem permanecer sanitizados e fora do Git até revisão humana explícita.

## 7. Ferramentas históricas de avaliação

Os comandos abaixo permanecem disponíveis apenas para reproduzir evidência histórica/offline. Uma
approval gerada por eles não participa do runtime V2-only, não é publicada em produção e não
autoriza tenant ou outbound:

```bash
npm run eval:conversation-v2:cycle-i
npm run lab:sign-approval -- --private-key-file /private/tmp/offline-authority.pem --claims-file /private/tmp/offline-claims.json --resolved-artifact-file /private/tmp/systemops-lab-resolved.json --output /private/tmp/offline-approval.json
```

## 8. Ativação live

Não use os comandos deste arquivo para ativar atendimento. Siga o runbook V2-only: audite todos os
candidatos operacionalmente ativos, pause somente o Lab por compare-and-set, feche o kill switch,
drene, implante, valide fechado, abra o switch e reative somente o UUID exato. Tenants pausados,
desabilitados, demo, prospect ou sem authority V2 permanecem fail-closed e inalterados.

## Incident report fields

- SHA e horário com timezone;
- UUID exato e actor;
- etapa, comando e reason codes sanitizados;
- contagens de jobs/outbounds e authority metrics;
- digest dos outros tenants antes/depois;
- nenhuma credencial, URL privada, telefone, conteúdo ou payload.
