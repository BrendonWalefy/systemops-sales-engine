# Log de Execução — Clínica 2

## 2026-06-14 18:43 -03

### Contexto

- Branch atual: `feat/clinic2-scale-foundation`
- Base documental usada:
  - `README.md`
  - `docs/architecture/current.md`
  - `docs/operations/change-control.md`

### Estado do worktree ao iniciar

- Mudança pré-existente fora do escopo: `next-env.d.ts`
- Item não rastreado fora do escopo: `test-results/`

### Achados principais da auditoria

- A oferta comercial está divergente entre docs e landings.
- O onboarding documentado é muito mais rico do que o onboarding executável.
- Há bugs P0 no onboarding wizard e na página de sugestões de playbook.
- A ativação manual de playbook ainda não usa o mesmo gate de publicação validada.
- O monitoramento existe, mas ainda é passivo e dependente de painel/log.

### Decisões registradas

- `dental-sync-bot` será a base da landing oficial.
- `systemops-landing` entra em descontinuação planejada.
- O próximo fluxo de onboarding deve virar um `Clinic Blueprint`.
- A execução começa por fixes P0 de baixo risco.

### Próximos passos imediatos

1. Corrigir bug de exclusão de tratamentos no wizard de onboarding.
2. Corrigir query de playbook ativo na tela de sugestões.
3. Adicionar gate de validação na ativação manual de playbook.
4. Rodar testes focados e atualizar este log.

### Como retomar em outra sessão

- Ler este arquivo e `docs/operations/clinic2-scale-backlog.md`.
- Confirmar branch atual com `git branch --show-current`.
- Verificar mudanças locais com `git status --short`.
- Continuar pelos itens em `Próximos passos imediatos`.

## 2026-06-14 18:46 -03

### Executado nesta rodada

- Criado backlog persistente em `docs/operations/clinic2-scale-backlog.md`.
- Corrigido bug de remoção de tratamentos no onboarding wizard.
- Corrigida query de playbook ativo na tela de sugestões.
- Adicionado gate de validação na ativação manual de playbook.
- Extraída função pura de sincronização de tratamentos para facilitar teste e manutenção.

### Arquivos alterados

- `docs/operations/clinic2-scale-backlog.md`
- `docs/operations/clinic2-execution-log.md`
- `src/application/onboarding/treatment-sync.ts`
- `src/app/(owner)/owner/onboarding/[clinicId]/actions.ts`
- `src/app/(clinic)/app/settings/playbook/suggestions/page.tsx`
- `src/app/(clinic)/app/settings/playbook/playbook-version-actions.ts`
- `src/__tests__/OnboardingTreatmentSync.test.ts`

### Validação executada

- `npm test -- src/__tests__/OnboardingTreatmentSync.test.ts` ✅
- `npm run typecheck` ✅

### Próxima fatia recomendada

1. Endurecer criação de clínica com status comercial e operacional mínimos.
2. Começar a migração da landing oficial para a base `dental-sync-bot`.
3. Definir a modelagem inicial do `Clinic Blueprint` antes de mexer em mais telas.

## 2026-06-14 18:55 -03

### Executado nesta rodada

- Expandido o contrato único de onboarding para incluir:
  - `receptionistPhone`
  - `calendarMode`
  - `googleCalendarId`
  - `isTest`
  - `plan`
  - `billingActive`
  - `monthlyRevenueBrl`
  - `billingStartedAt`
- Endurecida a tela de criação de clínica para capturar operação e cobrança mínima.
- Atualizado o script `create-clinic.ts` para aceitar o mesmo contrato.
- Extraída lógica comercial para helper puro e testável.

### Arquivos alterados

- `src/application/onboarding/clinic-commercial-settings.ts`
- `src/application/onboarding/onboarding-config.ts`
- `src/app/(owner)/owner/clinics/new/actions.ts`
- `src/app/(owner)/owner/clinics/new/page.tsx`
- `scripts/create-clinic.ts`
- `src/__tests__/ClinicCommercialSettings.test.ts`

### Validação executada

- `npm test -- src/__tests__/OnboardingTreatmentSync.test.ts src/__tests__/ClinicCommercialSettings.test.ts` ✅
- `npm run typecheck` ✅

### Estado funcional atual

- Clínica nova não precisa mais nascer com configuração comercial implícita.
- O owner já consegue marcar ambiente de teste, plano, cobrança ativa e modo de agenda na criação.
- O mesmo contrato agora serve para UI e script, reduzindo drift operacional.

### Próxima fatia recomendada

1. Começar a migração da landing oficial para a base `dental-sync-bot`.
2. Ajustar preços e CTA real na landing.
3. Depois disso, desenhar a primeira versão do `Clinic Blueprint`.

## 2026-06-14 19:14 -03

### Executado nesta rodada

- Consolidada a oferta comercial inicial na landing baseada em `../system-ops-lading_v2/dental-sync-bot`.
- Trocados CTAs placeholder por CTA real de WhatsApp para diagnóstico comercial.
- Ajustados metadados, pricing público e FAQ para refletir a oferta atual com menos promessas frágeis.
- Adicionada uma seção explícita de metodologia de implantação:
  - diagnóstico comercial
  - blueprint e configuração
  - go-live assistido
- Normalizada a formatação do arquivo da landing com `prettier` para destravar lint local.

### Repositório externo afetado

- Caminho: `../system-ops-lading_v2/dental-sync-bot`
- Branch de trabalho: `feat/systemops-official-offer`
- Arquivo principal alterado: `src/routes/index.tsx`

### Validação executada

- `npx eslint src/routes/index.tsx` ✅
- `npm run build` ✅

### Observações importantes

- Permanecem mudanças pré-existentes fora do escopo nesse repositório externo:
  - `src/routeTree.gen.ts`
  - `.vercel/`
  - `package-lock.json`
- A `systemops-landing` segue em descontinuação planejada e não foi alterada nesta rodada.

### Próxima fatia recomendada

1. Começar a primeira versão do `Clinic Blueprint` dentro do core.
2. Modelar status operacional da clínica para separar `test`, `active`, `paused` e `cancelled`.
3. Depois disso, ligar onboarding, playbook e go-live em um checklist único de implantação.

## 2026-06-14 19:24 -03

### Executado nesta rodada

- Criado o núcleo determinístico de `Clinic Blueprint` em `src/application/onboarding/clinic-blueprint.ts`.
- Adicionada uma leitura de prontidão da clínica no painel owner:
  - identidade
  - canal
  - agenda
  - playbook
  - tratamentos
  - go-live
- O detalhe da clínica agora mostra:
  - percentual de prontidão
  - status por bloco
  - principais lacunas para fechar a implantação
- Adicionados testes unitários para a regra de prontidão.

### Arquivos alterados

- `src/application/onboarding/clinic-blueprint.ts`
- `src/__tests__/ClinicBlueprint.test.ts`
- `src/app/(owner)/owner/clinics/[clinicId]/page.tsx`
- `docs/operations/clinic2-scale-backlog.md`
- `docs/operations/clinic2-execution-log.md`

### Validação executada

- `npm test -- src/__tests__/ClinicBlueprint.test.ts src/__tests__/ClinicCommercialSettings.test.ts src/__tests__/OnboardingTreatmentSync.test.ts` ✅
- `npm run typecheck` ✅
- `npx eslint src/application/onboarding/clinic-blueprint.ts 'src/app/(owner)/owner/clinics/[clinicId]/page.tsx' src/__tests__/ClinicBlueprint.test.ts` ✅

### Estado funcional atual

- Já existe uma visão objetiva do que falta para cada clínica sair de setup para go-live.
- O owner não depende mais só de memória ou leitura manual do onboarding para saber se a clínica está pronta.
- A próxima evolução natural é transformar essa leitura em um fluxo editável de blueprint durante a venda e a implantação.

### Próxima fatia recomendada

1. Levar o `Clinic Blueprint` para dentro do onboarding com perguntas estruturadas e resumo editável.
2. Criar status operacional explícito da clínica para distinguir `test`, `active`, `paused` e `cancelled`.
3. Ligar esse status ao monitoramento e aos crons para evitar processamento acidental de clínicas incompletas.

## 2026-06-14 19:28 -03

### Executado nesta rodada

- Evoluído o onboarding owner para funcionar como rascunho vivo do `Clinic Blueprint`.
- O wizard agora captura também:
  - provedor e credenciais do canal
  - telefone da recepção humana
  - modo de agenda e Google Calendar ID
  - plano comercial
  - cobrança ativa, valor mensal e início
  - ambiente de teste/produção
- Adicionada prévia de prontidão do blueprint dentro do próprio wizard.
- A revisão final do onboarding agora mostra o resumo comercial, operacional e de go-live.
- Corrigida a lógica de status do `Clinic Blueprint` para permitir `pending` real quando um bloco está totalmente vazio.

### Arquivos alterados

- `src/app/(owner)/owner/onboarding/[clinicId]/page.tsx`
- `src/app/(owner)/owner/onboarding/[clinicId]/actions.ts`
- `src/app/(owner)/owner/onboarding/[clinicId]/onboarding-wizard-client.tsx`
- `src/application/onboarding/clinic-blueprint.ts`
- `src/__tests__/ClinicBlueprint.test.ts`
- `docs/operations/clinic2-scale-backlog.md`
- `docs/operations/clinic2-execution-log.md`

### Validação executada

- `npm test -- src/__tests__/ClinicBlueprint.test.ts src/__tests__/ClinicCommercialSettings.test.ts src/__tests__/OnboardingTreatmentSync.test.ts` ✅
- `npm run typecheck` ✅
- `npx eslint 'src/app/(owner)/owner/onboarding/[clinicId]/onboarding-wizard-client.tsx' 'src/app/(owner)/owner/onboarding/[clinicId]/page.tsx' 'src/app/(owner)/owner/onboarding/[clinicId]/actions.ts' src/application/onboarding/clinic-blueprint.ts src/__tests__/ClinicBlueprint.test.ts 'src/app/(owner)/owner/clinics/[clinicId]/page.tsx'` ✅

### Estado funcional atual

- O onboarding já serve melhor para uso em venda e implantação porque concentra mais dados em um único fluxo.
- A pessoa que configura a clínica passa a enxergar a prontidão em tempo real, sem depender apenas da revisão final ou do painel owner.
- Ainda falta separar status operacional explícito por clínica para proteger crons e automações.

### Próxima fatia recomendada

1. Criar `clinic operational status` explícito (`test`, `active`, `paused`, `cancelled`) no domínio e no banco.
2. Usar esse status para bloquear crons, follow-ups e automações em clínicas incompletas.
3. Depois disso, transformar o onboarding em modo rascunho formal com checklist de go-live e publicação controlada.

## 2026-06-14 19:45 -03

### Executado nesta rodada

- Criado status operacional explícito de clínica com enum:
  - `prospect`
  - `test`
  - `active`
  - `paused`
  - `cancelled`
- Adicionada migration de banco para `clinics.operational_status`.
- Centralizada a regra de automação por clínica em policy única:
  - automação só roda quando `operational_status = active`
  - `autoReplyEnabled` continua sendo kill switch adicional
- Fluxos de criação e onboarding agora definem/sincronizam o status operacional.
- Toggle de auto-reply e toggle de teste agora atualizam o status operacional junto.
- Webhook Z-API e crons críticos passaram a respeitar o novo status.

### Arquivos alterados

- `src/application/clinics/clinic-operational-status.ts`
- `src/application/automation/clinic-automation-policy.ts`
- `src/infrastructure/db/schema.ts`
- `drizzle/0027_clinic_operational_status.sql`
- `drizzle/meta/_journal.json`
- `drizzle/meta/0027_snapshot.json`
- `src/app/(owner)/owner/clinics/new/actions.ts`
- `scripts/create-clinic.ts`
- `src/app/(owner)/owner/onboarding/[clinicId]/actions.ts`
- `src/app/api/clinic/auto-reply/route.ts`
- `src/app/(clinic)/app/settings/playbook/actions.ts`
- `src/app/(owner)/owner/clinics/[clinicId]/page.tsx`
- `src/app/api/whatsapp/zapi/route.ts`
- `src/app/api/cron/metrics-aggregate/route.ts`
- `src/app/api/cron/conversation-analytics/route.ts`
- `src/__tests__/ClinicAutomationPolicy.test.ts`
- `src/__tests__/ClinicOperationalStatus.test.ts`
- `docs/operations/clinic2-scale-backlog.md`
- `docs/operations/clinic2-execution-log.md`

### Validação executada

- `npm run db:generate` ✅
- `npm test -- src/__tests__/ClinicOperationalStatus.test.ts src/__tests__/ClinicAutomationPolicy.test.ts src/__tests__/ClinicBlueprint.test.ts src/__tests__/ClinicCommercialSettings.test.ts src/__tests__/OnboardingTreatmentSync.test.ts` ✅
- `npm run typecheck` ✅
- `npx eslint src/application/clinics/clinic-operational-status.ts src/application/automation/clinic-automation-policy.ts src/infrastructure/db/schema.ts 'src/app/(owner)/owner/clinics/new/actions.ts' scripts/create-clinic.ts 'src/app/(owner)/owner/onboarding/[clinicId]/actions.ts' src/app/api/clinic/auto-reply/route.ts 'src/app/(clinic)/app/settings/playbook/actions.ts' 'src/app/(owner)/owner/clinics/[clinicId]/page.tsx' src/app/api/whatsapp/zapi/route.ts src/app/api/cron/metrics-aggregate/route.ts src/app/api/cron/conversation-analytics/route.ts src/__tests__/ClinicAutomationPolicy.test.ts src/__tests__/ClinicOperationalStatus.test.ts` ✅

### Estado funcional atual

- Clínicas incompletas ou em teste deixam de depender apenas de `isTest` e `autoReplyEnabled` para bloquear automações.
- Agora existe uma camada operacional explícita que reduz risco de cron, outbound e webhook atuarem onde não devem.
- Ainda falta expor esse status de forma mais clara no owner/financeiro e usar isso no checklist formal de go-live.

### Próxima fatia recomendada

1. Expor `operational_status` no painel owner e financeiro com badges e filtros claros.
2. Criar checklist/go-live formal que promova `prospect` ou `test` para `active`.
3. Em seguida, transformar `/api/health` em healthcheck real e adicionar alertas ativos por clínica operacionalmente ativa.

## 2026-06-14 19:55 -03

### Executado nesta rodada

- Exposto `operational_status` de forma visível no owner:
  - visão geral
  - detalhe da clínica
  - financeiro
- Owner agora separa claramente:
  - operacionais (`active` e `paused`)
  - prospects
  - testes
  - canceladas
- Financeiro agora exclui explicitamente `prospect` e `test` do MRR e mostra essas clínicas em seções próprias.
- Corrigida a migration de status operacional para fazer backfill seguro das clínicas existentes:
  - `is_test = true` → `test`
  - `auto_reply_enabled = true` → `active`
  - caso contrário → `paused`

### Arquivos alterados

- `src/application/clinics/clinic-operational-status-presentation.ts`
- `src/app/(owner)/owner/page.tsx`
- `src/app/(owner)/owner/financeiro/page.tsx`
- `src/app/(owner)/owner/clinics/[clinicId]/page.tsx`
- `drizzle/0027_clinic_operational_status.sql`
- `docs/operations/clinic2-scale-backlog.md`
- `docs/operations/clinic2-execution-log.md`

### Validação executada

- `npm run typecheck` ✅
- `npx eslint src/application/clinics/clinic-operational-status-presentation.ts 'src/app/(owner)/owner/page.tsx' 'src/app/(owner)/owner/financeiro/page.tsx' 'src/app/(owner)/owner/clinics/[clinicId]/page.tsx' src/application/clinics/clinic-operational-status.ts src/application/automation/clinic-automation-policy.ts src/app/api/whatsapp/zapi/route.ts src/app/api/cron/metrics-aggregate/route.ts src/app/api/cron/conversation-analytics/route.ts` ✅
- `npm test -- src/__tests__/ClinicOperationalStatus.test.ts src/__tests__/ClinicAutomationPolicy.test.ts src/__tests__/ClinicBlueprint.test.ts src/__tests__/ClinicCommercialSettings.test.ts src/__tests__/OnboardingTreatmentSync.test.ts` ✅

### Estado funcional atual

- O owner consegue ver claramente quais clínicas estão prontas para operar, quais estão pausadas e quais ainda são prospects/teste.
- O financeiro ficou mais fiel à realidade operacional, reduzindo risco de contar pipeline comercial como MRR real.
- A próxima evolução natural é transformar essa leitura em promoção controlada de status via checklist de go-live.

### Próxima fatia recomendada

1. Criar checklist formal de go-live com promoção explícita para `active`.
2. Usar esse checklist para impedir ativação plena de clínicas ainda em `prospect` ou `test`.
3. Depois disso, endurecer `/api/health` e alertas ativos por clínica operacionalmente ativa.

## 2026-06-14 20:00 -03

### Executado nesta rodada

- Criado checklist formal de go-live no detalhe da clínica.
- Adicionada ação explícita de promoção para `active` baseada no `Clinic Blueprint`.
- A promoção de go-live agora:
  - zera `isTest`
  - liga `autoReplyEnabled`
  - define `operationalStatus = active`
- Removida a brecha de ativação indireta:
  - `prospect` não vira mais `active` só por ligar auto-reply
  - sair de `test` volta a clínica para `prospect`, exigindo checklist

### Arquivos alterados

- `src/app/(owner)/owner/clinics/[clinicId]/page.tsx`
- `src/application/clinics/clinic-operational-status.ts`
- `src/__tests__/ClinicOperationalStatus.test.ts`
- `docs/operations/clinic2-scale-backlog.md`
- `docs/operations/clinic2-execution-log.md`

### Validação executada

- `npm run typecheck` ✅
- `npm test -- src/__tests__/ClinicOperationalStatus.test.ts src/__tests__/ClinicAutomationPolicy.test.ts src/__tests__/ClinicBlueprint.test.ts src/__tests__/ClinicCommercialSettings.test.ts src/__tests__/OnboardingTreatmentSync.test.ts` ✅
- `npx eslint 'src/app/(owner)/owner/clinics/[clinicId]/page.tsx' src/application/clinics/clinic-operational-status.ts src/__tests__/ClinicOperationalStatus.test.ts src/application/clinics/clinic-operational-status-presentation.ts 'src/app/(owner)/owner/page.tsx' 'src/app/(owner)/owner/financeiro/page.tsx'` ✅

### Estado funcional atual

- O owner já enxerga a prontidão da clínica e consegue promover explicitamente para produção operacional.
- O sistema ficou muito mais resistente a ativações acidentais durante implantação ou testes.
- O próximo risco relevante já não é onboarding, e sim monitoramento ativo e consistência dos fluxos auxiliares.

### Próxima fatia recomendada

1. Transformar `/api/health` em healthcheck real usando `operational_status = active`.
2. Adicionar alertas ativos para webhook, cron e qualidade operacional por clínica ativa.
3. Revisar fluxos auxiliares remanescentes para garantir que nenhum bypass ignore o checklist de go-live.

## 2026-06-14 20:04 -03

### Executado nesta rodada

- Transformado `/api/health` em healthcheck real baseado apenas em clínicas com `operational_status = active`.
- O healthcheck agora valida, por clínica ativa:
  - credenciais mínimas do canal configurado
  - presença de playbook ativo
  - recência do snapshot de métricas
- A página owner de qualidade passou a seguir a mesma régua operacional, filtrando clínicas ativas em vez de depender apenas de `autoReplyEnabled`.
- Adicionados testes unitários para a avaliação determinística de saúde operacional.

### Arquivos alterados

- `src/application/health/clinic-health.ts`
- `src/__tests__/ClinicHealth.test.ts`
- `src/app/api/health/route.ts`
- `src/app/(owner)/owner/qualidade/page.tsx`
- `docs/operations/clinic2-scale-backlog.md`
- `docs/operations/clinic2-execution-log.md`

### Validação executada

- `npm run typecheck` ✅
- `npx eslint src/application/health/clinic-health.ts src/__tests__/ClinicHealth.test.ts src/app/api/health/route.ts 'src/app/(owner)/owner/qualidade/page.tsx' src/application/clinics/clinic-operational-status.ts src/application/automation/clinic-automation-policy.ts` ✅
- `npm test -- src/__tests__/ClinicHealth.test.ts src/__tests__/ClinicOperationalStatus.test.ts src/__tests__/ClinicAutomationPolicy.test.ts src/__tests__/ClinicBlueprint.test.ts src/__tests__/ClinicCommercialSettings.test.ts src/__tests__/OnboardingTreatmentSync.test.ts` ✅

### Estado funcional atual

- O projeto agora tem um healthcheck que reflete melhor a saúde real da operação multi-clínica.
- Clínicas incompletas em `prospect`, `test`, `paused` ou `cancelled` deixam de poluir a leitura de saúde de produção.
- O próximo gap principal já não é detecção, e sim notificação ativa quando uma clínica operacional degrada.

### Próxima fatia recomendada

1. Adicionar alertas ativos para webhook, cron e qualidade operacional por clínica ativa.
2. Revisar KPIs e relatórios auxiliares que ainda possam depender de filtros legados por `autoReplyEnabled`.
3. Depois disso, endurecer armazenamento de credenciais por clínica com criptografia.

## 2026-06-14 20:09 -03

### Executado nesta rodada

- Criada uma camada determinística única de alertas operacionais em `src/application/health/operational-alerts.ts`.
- Os alertas agora consolidam, por clínica `active`:
  - configuração crítica incompleta
  - ausência de playbook ativo
  - cron sem snapshot recente
  - possível falha de entrada via webhook
  - degradação de qualidade diária (`unclear` e `needs_human`)
- `/api/health` passou a expor também a lista e a contagem desses alertas operacionais.
- A home do owner agora mostra um resumo vivo dos alertas operacionais e reutiliza a mesma régua na coluna de alertas por clínica.
- Adicionados testes unitários específicos para a composição dos alertas.

### Arquivos alterados

- `src/application/health/operational-alerts.ts`
- `src/__tests__/OperationalAlerts.test.ts`
- `src/app/api/health/route.ts`
- `src/app/(owner)/owner/page.tsx`
- `docs/operations/clinic2-scale-backlog.md`
- `docs/operations/clinic2-execution-log.md`

### Validação executada

- `npm run typecheck` ✅
- `npx eslint src/application/health/clinic-health.ts src/application/health/operational-alerts.ts src/__tests__/ClinicHealth.test.ts src/__tests__/OperationalAlerts.test.ts src/app/api/health/route.ts 'src/app/(owner)/owner/page.tsx' 'src/app/(owner)/owner/qualidade/page.tsx'` ✅
- `npm test -- src/__tests__/ClinicHealth.test.ts src/__tests__/OperationalAlerts.test.ts src/__tests__/ClinicOperationalStatus.test.ts src/__tests__/ClinicAutomationPolicy.test.ts src/__tests__/ClinicBlueprint.test.ts src/__tests__/ClinicCommercialSettings.test.ts src/__tests__/OnboardingTreatmentSync.test.ts` ✅
- `npm run verify` ✅

### Observações importantes

- O `npm run verify` passou com warnings de lint já existentes fora do escopo desta rodada; não houve erro bloqueante.
- Ainda não há notificação externa automática desses alertas; nesta etapa o ganho foi consolidar e tornar ativa a leitura operacional no owner e no healthcheck.

### Estado funcional atual

- O owner não depende mais de leitura manual de métricas isoladas para perceber degradação operacional.
- Webhook, cron e qualidade agora aparecem em uma régua única por clínica ativa.
- O sistema já tem uma base segura para no próximo passo ligar notificações externas ou criptografia sem reinventar os critérios de alerta.

### Próxima fatia recomendada

1. Endurecer armazenamento de credenciais por clínica com criptografia.
2. Revisar pontos restantes do owner/financeiro/qualidade que ainda possam depender de filtros legados.
3. Depois disso, decidir se o próximo salto de monitoramento será notificação externa para owner ou evolução da fila/worker.

## 2026-06-14 20:31 -03

### Executado nesta rodada

- Instalada dependência `resend` para envio de e-mail transacional.
- Criada camada de notificação em `src/infrastructure/notifications/`:
  - `email-sender.ts` — cliente Resend com fallback de console quando `RESEND_API_KEY` não está definida.
  - `alert-email-template.ts` — HTML responsivo do digest de alertas (dark mode, contagens crítico/aviso, lista por clínica, CTA para o painel).
- Criado cron `/api/cron/operational-alert-digest`:
  - Roda diariamente às 9h UTC (6h SP).
  - Busca clínicas ativas, avalia alertas com `evaluateOperationalAlerts()`.
  - Envia digest por e-mail ao owner apenas se há alertas; retorna `sent: false, reason: no_alerts` quando tudo está saudável.
  - Protegido por `CRON_SECRET`.
- Adicionado cron ao `vercel.json`.
- Adicionados comentários sobre `RESEND_API_KEY` e `RESEND_FROM_EMAIL` ao `.env.local`.

### Arquivos alterados

- `package.json` / `package-lock.json` — resend adicionado
- `src/infrastructure/notifications/email-sender.ts` (novo)
- `src/infrastructure/notifications/alert-email-template.ts` (novo)
- `src/app/api/cron/operational-alert-digest/route.ts` (novo)
- `vercel.json`
- `.env.local`
- `src/__tests__/AlertEmailTemplate.test.ts` (novo)
- `docs/operations/clinic2-scale-backlog.md`
- `docs/operations/clinic2-execution-log.md`

### Validação executada

- `npm run typecheck` ✅
- `npx vitest run src/__tests__/AlertEmailTemplate.test.ts` — 5/5 ✅
- Suite completo da rodada (4 arquivos, 20 testes) ✅

### Ação manual necessária para ativar em produção

1. Criar conta em [resend.com](https://resend.com) e verificar o domínio `systemops.app` (ou usar o sandbox `onboarding@resend.dev` para testes iniciais).
2. Gerar uma API Key no painel Resend.
3. Adicionar ao Vercel:
   - `RESEND_API_KEY=re_...`
   - `RESEND_FROM_EMAIL=SystemOps <noreply@systemops.app>`

### Estado funcional atual

- A notificação existe mas está em modo console-fallback até a `RESEND_API_KEY` ser configurada.
- O cron já está registrado no Vercel e vai disparar diariamente às 9h UTC.
- Quando não houver alertas, nenhum e-mail é enviado — sem spam em dias saudáveis.

### Próxima fatia recomendada

1. Configurar Resend em produção (ver ação manual acima).
2. Blueprint em modo rascunho formal com suporte multi-dispositivo.
3. Padronização do playbook (reduzir dependência de `notes` livre).

## 2026-06-14 20:17 -03

### Executado nesta rodada

- Criada camada de criptografia AES-256-GCM em `src/infrastructure/crypto/credential-vault.ts`.
- Tokens sensíveis (`zapiToken`, `zapiClientToken`, `metaAccessToken`) agora são encriptados na gravação e decriptados na leitura.
- O `zapiInstanceId` foi mantido em plaintext intencionalmente — é usado como chave de lookup no webhook e não é um segredo operacional.
- A decriptação é tolerante ao período de migração: valores sem prefixo `enc:v1:` são aceitos como plaintext legado (com warning em produção).
- Criado script idempotente `scripts/encrypt-existing-credentials.ts` para migrar credenciais existentes no banco.
- Auditados os usos de `autoReplyEnabled` — todos são legítimos (toggle UI ou kill-switch lido via `shouldSendAutomatedClinicOutbound`); o webhook já opera sobre `operationalStatus`.

### Arquivos alterados

- `src/infrastructure/crypto/credential-vault.ts` (novo)
- `src/infrastructure/adapters/channels/whatsapp/channel-config.ts`
- `src/app/(owner)/owner/onboarding/[clinicId]/actions.ts`
- `src/app/(owner)/owner/clinics/new/actions.ts`
- `scripts/create-clinic.ts`
- `scripts/encrypt-existing-credentials.ts` (novo)
- `src/__tests__/CredentialVault.test.ts` (novo)
- `docs/operations/clinic2-scale-backlog.md`
- `docs/operations/clinic2-execution-log.md`

### Validação executada

- `npm run typecheck` ✅
- `npx vitest run src/__tests__/CredentialVault.test.ts` — 9/9 ✅
- Suite completo do workstream (8 arquivos, 30 testes) ✅

### Ação manual necessária em produção

1. Gerar a chave: `openssl rand -hex 32`
2. Adicionar `CREDENTIAL_ENCRYPTION_KEY=<valor>` ao `.env` de produção (Vercel/Railway).
3. Rodar `npx dotenv -e .env.local -- npx tsx scripts/encrypt-existing-credentials.ts` uma vez.

### Estado funcional atual

- Credenciais de canal não ficam mais em plaintext no banco.
- O sistema é retrocompatível com credenciais antigas (período de migração com fallback).
- P2 do backlog inteiramente concluído.

### Próxima fatia recomendada

1. Configurar `CREDENTIAL_ENCRYPTION_KEY` em produção e rodar o script de migração.
2. Avaliar notificação externa dos alertas operacionais (e-mail ou webhook) para o owner.
3. Decidir entre expandir o `Clinic Blueprint` (modo rascunho formal) ou iniciar a arquitetura de fila/worker.
