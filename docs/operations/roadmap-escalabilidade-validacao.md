# ROADMAP DE ESCALABILIDADE — Do Vitalli para N Clientes

**Visão**: Transformar validação de Vitalli (processo manual) em **template automático** que funcione para QUALQUER cliente  
**Timeline**: T (ago/2026) até T+60 (out/2026) — 3 meses para full automation  
**ROI**: 1 script + 1 template = reduz tempo de validação de 7 dias → 1 dia (automático)

---

## FASE 1: VITALLI PILOTO (T até T+7 | AGO 8-14)

**Objetivo**: Validar que o processo funciona manualmente. Use este como baseline para depois automatizar.

### Semana 1: Implementação manual + go-live

| Dia | Task | Owner | Status |
|-----|------|-------|--------|
| **T (08/07)** | Baseline capture + aprovação | Brendon | ⏳ |
| **T+1-2** | P0.1-P0.2 implementation | engenheiro-conversa | ⏳ |
| **T+3-4** | P0.3-P0.6 implementation | especialista-infra | ⏳ |
| **T+5** | E2E com Gleice | Gleice | ⏳ |
| **T+6** | Pre-launch checklist | Brendon | ⏳ |
| **T+7** | 🚀 Go-live | Operações | ⏳ |

### Saídas documentadas

```
docs/product/client-validation/vitalli-07-2026/
├── auditoria-20-conversas.md              ← Manual (será template)
├── plano-acao-t+7-dias.md                 ← Manual (será automated)
├── executive-summary.html                 ← Manual (será automated)
├── baseline-metrics.json                  ← Manual (será automated)
└── lessons-learned.md                     ← Filler pós-launch (T+14)
```

### Lições para colher (anotadas durante implementação)

- ✏️ Quais P0.x realmente ajudaram vs quais foram desnecessárias?
- ✏️ Gleice feedback: A E2E foi suficiente ou faltou algo?
- ✏️ Tempo real vs estimado para cada fase?
- ✏️ Bugs encontrados no pipeline real (não no simulador)?
- ✏️ Mudanças no playbook necessárias durante implementação?

---

## FASE 2: TEMPLATE GENÉRICO (T+7 até T+30 | AGO 14-31)

**Objetivo**: Converter processo Vitalli em template reutilizável. Ao final, funciona para qualquer cliente.

### 2A: Documentar o template (2 dias)

**Semana 2 (T+7 até T+14)**

```bash
# Tarefas
└─ Criar _template/ pasta
   ├─ _template/auditoria-TEMPLATE.md          (generalize de Vitalli)
   ├─ _template/plano-acao-TEMPLATE.md        
   ├─ _template/executive-summary-TEMPLATE.html
   ├─ _template/baseline-metrics-TEMPLATE.json
   ├─ _template/checklist-TEMPLATE.md
   └─ _template/README.md

# Output
docs/product/client-validation/
├── _template/                                (genérico, reutilizável)
└── vitalli-07-2026/                          (concrete instance)
    └── auditoria-20-conversas.md             (concrete data)
```

**Owner**: revisor-multitenant (garante que template é genérico, não vitalli-específico)

**Checklist**:
- [ ] Nenhum "Vitalli" hardcoded no template
- [ ] Placeholders para `{clinic_name}`, `{clinic_plan}`, `{month}`, etc
- [ ] Exemplos genéricos (não só lentes, também outras especialidades)
- [ ] Reutilizável em 3+ clínicas (validate com Ximendes + NC Beauty)

---

### 2B: Script de automação — Parte 1 (3 dias)

**Semana 2-3 (T+14 até T+21)**

Criar: `scripts/client-validation-pipeline.ts` (vide Parte 3 do Playbook)

```typescript
// Entrada: clinicSlug
// Saída: todos 5 documentos do _template, preenchidos com dados reais

npx tsx scripts/client-validation-pipeline.ts --clinic vitalli --days 7 --limit 20
// Output: docs/product/client-validation/vitalli-07-2026-validated/*
```

**Milestones**:
1. Script extrai 20 conversas do banco ✓
2. Script roda replay contra pipeline real ✓
3. Script gera auditoria.md (template + dados) ✓
4. Script gera plano-acao.md (estimando T+N via algoritmo) ✓
5. Script gera executive-summary.html ✓
6. Script gera baseline-metrics.json ✓
7. Script tudo pronto para merge ✓

**Owner**: engenheiro-conversa

**Testing**: 
```bash
# Rodar contra Vitalli (expected output conhecido)
npx tsx scripts/client-validation-pipeline.ts --clinic vitalli --days 7 --limit 20

# Validar:
# - Arquivo gerado em docs/product/client-validation/vitalli-07-2026/?
# - Conteúdo matches manual auditoria?
# - Scores corretos?
# - HTML renderiza?
```

---

### 2C: Script de automação — Parte 2 (3 dias)

**Semana 3 (T+21 até T+28)**

Criar: `scripts/slack-notify-validation.ts`

```typescript
// Input: clinic, status, reportPath
// Output: Slack notification com link para docs

POST #vitalli-live
  "✅ Auditoria de Vitalli pronta (score 60%)"
  "Docs: https://github.com/repo/docs/product/client-validation/vitalli-07-2026/"
  "Ação: Tech lead review + decisão de P0.x"
```

Criar: `scripts/github-issue-validation.ts`

```typescript
// Se score < 85%, criar issue automático
gh issue create \
  --title "Validation failed: Vitalli (score 62%)" \
  --body "See docs/product/client-validation/vitalli-07-2026/" \
  --label "validation" \
  --label "vitalli"
```

**Owner**: especialista-infra (coordena com CI/CD)

---

### 2D: Retroativamente auditar Ximendes (2 dias)

**Semana 3 (T+21 até T+28)**

Ximendes já tem dados desde julho. Rodar auditoria retrospectiva:

```bash
npx tsx scripts/client-validation-pipeline.ts --clinic ximendes --days 30 --limit 20
# (Data retrospectiva, não esperar mais 7 dias)
```

**Esperado**:
- Score: ~58% (conforme auditoria manual de Jul/2026)
- Mesmos padrões F1, F3, F5 que em Vitalli
- Template funciona para "caso real anterior"

**Saída**:
```
docs/product/client-validation/ximendes-07-2026/
├── auditoria-20-conversas.md
├── plano-acao-t+3-dias.md        (mais curto que Vitalli, já têm pattern)
├── executive-summary.html
├── baseline-metrics.json
└── lessons-learned.md            (vazio, preenchido post-launch)
```

**Owner**: revisor-multitenant

**Decisão pós-auditoria**: 
- Ximendes já está em produção. Aplicar P0.1-P0.6 retroativamente?
- SIM (será melhora, sem risco)
- Timeline: T+28 até T+35 (aplicar P0.x paralelo com Vitalli)

---

### 2E: Auditar NC Beauty (em shadow mode) (2 dias)

**Semana 4 (T+28 até T+35)**

NC Beauty criada recentemente, em shadow mode desde early-julho. Dados disponíveis:

```bash
npx tsx scripts/client-validation-pipeline.ts --clinic nc-beauty --days 14 --limit 20
# (Menos dias, menos volume)
```

**Esperado**:
- Score: TBD (primeira vez auditando)
- Diferentes padrões que Vitalli? (Beauty/estética vs lentes odonto)
- Template funciona para especialidade diferente?

**Saída**:
```
docs/product/client-validation/nc-beauty-07-2026/
├── auditoria-20-conversas.md
├── plano-acao-t+5-dias.md        (médio, dado volume menor)
├── executive-summary.html
├── baseline-metrics.json
└── ...
```

**Owner**: engenheiro-conversa

---

## FASE 3: AUTOMAÇÃO COMPLETA (T+30 até T+60 | AGO 30-SET 30)

**Objetivo**: Nenhuma ação manual necessária. GitHub Actions + scripts rodando sozinhos.

### 3A: GitHub Actions workflow (3 dias)

**Semana 5 (T+35 até T+42)**

Criar: `.github/workflows/client-validation-check.yml` (vide Parte 9 do Playbook)

```yaml
on:
  schedule:
    # Toda segunda-feira 09:00 UTC (13:00 São Paulo)
    - cron: '0 9 * * 1'

jobs:
  validate:
    # Roda client-validation-pipeline.ts para TODAS as clínicas
    # Envia relatórios para docs/product/client-validation/
    # Notifica Slack + cria issue se score < 85%
```

**Milestones**:
1. Workflow dispara toda segunda (schedule working) ✓
2. Para cada clínica em `organizations`, roda validation ✓
3. Gera docs automaticamente ✓
4. Notifica #vitalli-live, #ximendes-live, etc ✓
5. Cria issue no Jira se score < 85% ✓

**Owner**: especialista-infra

**Testing**:
```bash
# Trigger manual
gh workflow run client-validation-check.yml -f clinic_slug=vitalli

# Verificar
ls -la docs/product/client-validation/
```

---

### 3B: Centralizar métricas em dashboard (5 dias)

**Semana 5-6 (T+35 até T+49)**

Criar: `scripts/sync-metrics-to-dashboard.ts`

```typescript
// Lê docs/product/client-validation/*/baseline-metrics.json
// Converte para formato Grafana/Tableau/Google Sheets
// Sincroniza com dashboard centralizado
```

**Dashboard mostra**:
- Todos os clientes com score, trend over time
- F1/F3/F5 counts por clínica
- Timeline estimada vs real por fase
- Go-live dates histórico
- NPS pós-launch por clínica

**Output**: Grafana dashboard (ou Tableau / Google Sheets)

**Owner**: especialista-infra

---

### 3C: Runbook + training (2 dias)

**Semana 6 (T+42 até T+49)**

Criar: `docs/operations/client-validation-runbook.md` (vide Parte 13 do Playbook)

```markdown
# Client Validation Runbook — Para Tech Lead

## Quick Reference (1 página)
## Detailed Steps (5 páginas)
## Troubleshooting (2 páginas)
## FAQ (1 página)

Total: 10 páginas, pronto para print + aprender
```

**Training session** (2h, toda team):
- Como usar o runbook
- Como ler auditoria report
- Como tomar decisão P0.x vs custom
- Como fazer E2E com operador local
- Como resolver "blocker não esperado"

**Owner**: Brendon (orquestra, apresenta)

---

### 3D: Validar template em 3 clínicas (1 dia)

**Semana 6 (T+49)**

Garantir que template é realmente genérico:

```bash
# Rodar em Vitalli (done), Ximendes (done), NC Beauty
npx tsx scripts/client-validation-pipeline.ts --clinic vitalli --days 7 --limit 20
npx tsx scripts/client-validation-pipeline.ts --clinic ximendes --days 7 --limit 20
npx tsx scripts/client-validation-pipeline.ts --clinic nc-beauty --days 7 --limit 20

# Verificar:
# - Todos 3 geraram docs sem erro?
# - Conteúdo é diferente (específico de cada clínica)?
# - Template é genérico (não vitalli-specific)?
```

**Resultado**:
- ✅ Template validado em 3 clínicas
- ✅ Pronto para escalar para N clínicas

---

## FASE 4: INTEGRAÇÃO COM SALES + OPS (T+60 até T+90 | OUT 1-30)

**Objetivo**: Validação é parte do onboarding normal, não exceção.

### 4A: Documentar fluxo de venda (1 dia)

**Semana 9 (T+60 até T+67)**

Atualizar: `docs/operations/sales-to-production-flow.md`

```markdown
# Fluxo: Venda até Produção (com Validação Integrada)

1. Prospect → Venda → Contrato assinado ← 3-5 dias
2. Kickoff → Shadow mode ativada ← 1 dia
3. Operador local treina ← 2-3 dias
4. Aguardar 7 dias de dados
5. ✨ AUTO: Auditoria rodada (GitHub Actions)
6. Tech lead revisa auditoria + decide P0.x
7. Implementar P0.x (si necessário) ← 2-5 dias
8. E2E com operador ← 1 dia
9. 🚀 Go-live ← 1 dia
10. Monitoring 24h-7 dias

Total: 14-30 dias (dependendo de P0.x necessários)
```

**Owner**: estrategista-gtm + especialista-infra

---

### 4B: Contrato padrão (1 dia)

**Semana 9**

Adicionar cláusula de validação:

```
"Cláusula 7 — Validação de Qualidade

A SystemOps fará auditoria de qualidade de IA antes do go-live, 
garantindo 85%+ de acurácia em testes reais. 
Essa validação é parte do contrato (não custo adicional).

Benchmark:
- Score < 85% → Implementar P0.x até atingir target
- Score ≥ 85% → E2E com operador → Go-live
- Prazo típico: 7-30 dias (conforme volume)

Responsabilidade compartilhada:
- SystemOps: Implementação + QA
- Cliente: Operador disponível para E2E
"
```

**Owner**: estrategista-gtm

---

### 4C: Pós-launch monitoring automático (2 dias)

**Semana 10 (T+67 até T+74)**

Criar: `scripts/monitor-post-launch.ts`

```typescript
// Roda todo dia pela 1ª semana pós-launch
// Coleta: errors/min, response time, manual intervention %
// Compara com target do cliente
// Se qualquer métrica > threshold → alert Slack + escalate

Interface:
- Sentry: Errors by intent, crashes
- Analytics: Response time P95, primeira resposta <1min
- Operador feedback: Manual intervention count
```

**Dashboard pós-launch** (mostra 7 dias):
- Erro trend
- Manual intervention trend
- Lead satisfaction (NPS)
- Compare vs baseline (pré-launch)

**Owner**: guardião-operacional

---

### 4D: Histórico + lições aprendidas (2 dias)

**Semana 10**

Após cada cliente em produção por 7+ dias:

```markdown
# Lessons Learned — [Clinic]

## O que funcionou
- [P0.1 foi muito efetivo em reduzir F1]
- [E2E com operador ajudou encontrar edge cases]
- [Timeline T+5 foi realista para esse plano]

## O que não funcionou
- [Nem todos P0.x eram necessários]
- [Comunicação com operador poderia ser melhor]

## Sugestões para próximo cliente
- [Adicionar P0.7 para X problema emergente]
- [Reduzir P0.x baseline para Y tipo de clínica]
- [Treinamento operador deve incluir Z]

## Dados
- Score: 60% → 87% (27 pontos)
- Manual intervention: 30% → 8% (22 pontos)
- Lead satisfaction: NPS +15
- Cost of deployment: R$ [X]
```

**Owner**: revisor-multitenant (coleta de toda team)

---

## SUMÁRIO: ROADMAP VISUAL

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  PHASE 1: VITALLI PILOTO                   PHASE 2: TEMPLATE GENÉRICO       │
│  (T até T+7)                               (T+7 até T+30)                  │
│  Manual process                            ✨ Auto pipeline                 │
│  Aprova conceito                           Valida em 3 clínicas            │
│  ↓                                         ↓                                │
│  ┌─────────────────────┐                   ┌────────────────────────┐      │
│  │ Baseline (1 day)    │                   │ 5 docs templates       │      │
│  │ P0.1-P0.6 (5 days)  │                   │ client-validation...ts │      │
│  │ E2E (1 day)         │                   │ Slack + GitHub issue   │      │
│  │ Go-live (1 day)     │                   │ Ximendes retroativo    │      │
│  │                     │                   │ NC Beauty auditoria    │      │
│  │ ✅ Vitalli LIVE     │                   │ ✅ Template validated  │      │
│  └─────────────────────┘                   └────────────────────────┘      │
│                          ╲                /                                │
│                           ╲              /                                 │
│                            ╲            /                                  │
│                             ╲          /                                   │
│  PHASE 3: AUTOMATION               PHASE 4: INTEGRATION                    │
│  (T+30 até T+60)                   (T+60 até T+90)                        │
│  ✨ Auto everything                Sales + Ops integrated                 │
│  ↓                                 ↓                                       │
│  ┌─────────────────────────────┐   ┌───────────────────────────────────┐ │
│  │ GitHub Actions workflow     │   │ Contrato padrão (validação)       │ │
│  │ Weekly auto-audit           │   │ Runbook + training (para team)    │ │
│  │ Centralized dashboard       │   │ Pós-launch monitoring auto        │ │
│  │ Slack + Jira integration    │   │ Histórico + lições aprendidas    │ │
│  │ ✅ N clientes escalável     │   │ ✅ Processo é standard OPS       │ │
│  └─────────────────────────────┘   └───────────────────────────────────┘ │
│                                                                             │
│  RESULT: 1 script + 1 template = Qualidade garantida para qualquer cliente │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## GANHO DE TEMPO: ANTES vs DEPOIS

| Atividade | Antes (Manual) | Depois (Automático) | Ganho |
|-----------|---|---|---|
| Extrair 20 conversas | 1h | 5 min | 12x |
| Rodar replay | 30 min | 2 min | 15x |
| Analisar padrões | 3h | Auto + 30 min review | 6x |
| Gerar auditoria.md | 2h | 5 min | 24x |
| Gerar plano-acao.md | 2h | 5 min | 24x |
| Gerar summary.html | 1h | 2 min | 30x |
| Total por cliente | ~10h | ~1h | 10x |

**Implicação**: 10 clientes = 100 horas (manual) vs 10 horas (automático)

---

## INVESTIMENTO NECESSÁRIO

| Phase | Dev hours | QA hours | Docs hours | Total |
|-------|-----------|----------|-----------|-------|
| **Phase 1** (Vitalli pilot) | — | — | — | 0 (já feito) |
| **Phase 2** (Template) | 15 | 5 | 5 | **25 hours** |
| **Phase 3** (Automation) | 20 | 10 | 5 | **35 hours** |
| **Phase 4** (Integration) | 10 | 5 | 10 | **25 hours** |
| **Total** | — | — | — | **85 hours** |

**Timeline**: 3 meses (spread across phases)  
**Team**: 1 engenheiro + 1 especialista-infra (mostly)  
**ROI**: 85 horas investimento = 10 horas por cliente × N clientes futuros

Se chegar a 10 clientes: ROI positivo em cliente #2.  
Se chegar a 100 clientes: 850 horas economizadas.

---

## CRITICAL PATH (O que não pode atrasar)

🔴 **CRITICAL**:
1. ✅ Vitalli go-live (T+7) — sem isso, validação falha
2. ⏳ Template criação (T+30) — bloqueia automação
3. ⏳ GitHub Actions (T+50) — sem isso, não é auto

🟡 **IMPORTANT** (pode atrasar 1-2 weeks):
- Dashboard
- Runbook training
- Pós-launch monitoring

🟢 **NICE TO HAVE** (pode ficar para depois):
- Historical data migration
- Advanced analytics

---

## GATES: GO/NO-GO DECISIONS

### Gate 1: Vitalli go-live (T+7)
**Decision**: Shadow mode → live?  
**Criteria**: Score ≥85% + E2E OK  
**Owner**: Brendon + revisor-multitenant  
**If NO**: Extend shadow mode +7 days, retry

### Gate 2: Template validated (T+30)
**Decision**: Template ready for scale?  
**Criteria**: Works in Vitalli + Ximendes + NC Beauty, no vitalli-specific hardcoding  
**Owner**: revisor-multitenant  
**If NO**: Fix template, retest in 3 clínicas

### Gate 3: Automation live (T+60)
**Decision**: Auto-audit ready for production?  
**Criteria**: GitHub Actions working, Slack/Jira integrations OK, validated in test run  
**Owner**: especialista-infra  
**If NO**: Fix automation, retest

### Gate 4: Process scaled (T+90)
**Decision**: Can we deploy this to ANY new client?  
**Criteria**: 1+ new client (not pilot) passed full pipeline successfully  
**Owner**: Brendon  
**If NO**: Debug, improve template, retry with next client

---

## COMUNICAÇÃO

### Kickoff (T+1, after Vitalli launch starts)
- Apresentar roadmap ao time
- Distribuir fases e responsabilidades
- Set weekly syncs

### Weekly standup (Tuesdays 10:00)
- Progress update
- Blockers
- Next week priorities

### Gate reviews (Every 30 days)
- Full team sync
- Demo de artifacts (template, automation, dashboard)
- Go/no-go decision

### Public docs
- Update `docs/operations/` with runbook (T+49)
- Post to team wiki (T+49)
- Include in onboarding training (T+60)

---

## SUCCESS CRITERIA

By **T+90 (October 31, 2026)**:

✅ Vitalli em produção com 87%+ acurácia  
✅ Ximendes + NC Beauty em produção com improved scores  
✅ Template pronto para scale (validado em 3+ clínicas)  
✅ GitHub Actions auto-audit rodando todas semanas  
✅ Dashboard centralizado mostrando todos clientes  
✅ Runbook documentado + team treinada  
✅ Novo cliente passando por full pipeline automaticamente  
✅ Tempo de validação reduzido de 10h → 1h (manual → auto)  

---

**This roadmap is YOUR go-to reference for the next 3 months.**

**Imprimir, laminar, colar na parede. 📌**

Sucesso! 🚀
