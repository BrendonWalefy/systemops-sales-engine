# PLAYBOOK DE VALIDAÇÃO ESCALÁVEL — Para Qualquer Cliente

**Objetivo**: Transformar o processo Vitalli em um template reutilizável que garanta qualidade de launch para QUALQUER cliente  
**Contexto**: Vitalli é o piloto (T+7 dias até go-live com 85%+ acurácia). Este playbook documenta como replicar em N clientes.  
**Resultado esperado**: Cada novo cliente passa por auditoria sistematizada, teste real com pipeline completo, e E2E com operador local.

---

## PARTE 1 — VISÃO GERAL: DO VITALLI PARA QUALQUER CLIENTE

### O que funcionou em Vitalli (essência do template)

| Fase | O que faz | Duração | Risco | Saída |
|------|-----------|---------|-------|-------|
| **A — Baseline** | Rodar replay com 20 últimas conversas contra pipeline REAL | 1 dia | Baixo | Score inicial + report de F1/F3/F5 |
| **B — Implementação** | Aplicar P0.1-P0.6 fixes (guards determinísticos) | 3-5 dias | Médio | PRs validated contra Baseline + Ximendes |
| **C — E2E** | Operador local testa 5 conversas reais no WhatsApp | 1 dia | Baixo | Feedback qualitativo, NPS |
| **D — Go-live** | Desligar shadow mode com monitoring 24h | 1 dia | Alto | Métricas em produção |

**O padrão**:
1. **Capture** — Baseline com replay real (não simulador)
2. **Improve** — Aplicar fixes determinísticas + validação cruzada
3. **Validate** — E2E com operador + monitoramento
4. **Launch** — Go-live com garantia de qualidade

### Por que isso escala

- ✅ **Reproduzível**: Script automático, não manual
- ✅ **Verificável**: Métricas concretas (score %), não achismo
- ✅ **Reversível**: Cada PR testada, rollback fácil
- ✅ **Seguro**: Validação retroativa (sem quebrar outras clínicas)
- ✅ **Documentado**: Cada cliente tem seu relatório + timeline

---

## PARTE 2 — FRAMEWORK: ESTRUTURA DE PASTA POR CLIENTE

```
docs/product/client-validation/
├── _template/                                  (TEMPLATE GENÉRICO)
│   ├── baseline-YYYY-MM-DD.md                 (Snapshot de análise)
│   ├── action-plan-T+7-days.md                (Timeline de implementação)
│   ├── executive-summary.html                 (Visual para stakeholders)
│   └── go-live-checklist.md                   (Checklist final)
│
├── vitalli-07-2026/                           (PILOTO - VITALLI)
│   ├── auditoria-20-conversas.md
│   ├── plano-acao-t+7-dias.md
│   ├── validacao-e2e-gleice.md                (Feedback após launch)
│   ├── metricas-semana1.json                  (KPIs pós-launch)
│   └── lessons-learned.md                     (O que aprendemos)
│
├── ximendes-07-2026/                          (PRÓXIMO - XIMENDES RETROATIVO)
│   ├── auditoria-20-conversas.md
│   ├── plano-acao-t+3-dias.md                 (Mais curto, já têm pattern)
│   ├── metricas-baseline.json
│   └── ...
│
└── nc-beauty-07-2026/                         (PARALELO - NC BEAUTY)
    ├── auditoria-20-conversas.md
    ├── plano-acao-t+5-dias.md
    └── ...
```

**Padrão de naming**: `{cliente}-{mes}-{ano}/`  
**Padrão de documentação**: Cada cliente tem 4 arquivos (auditoria + plano + validação + lições aprendidas)

---

## PARTE 3 — PIPELINE AUTOMÁTICO DE VALIDAÇÃO

### Entrada: Novo cliente criado

```bash
# Sistema: Quando organização criada no banco
trigger: organizations.INSERT

# Automação: Enviar payload para webhook
POST /webhooks/client-created
{
  "clinicId": "...",
  "clinicName": "Clínica XYZ",
  "clinicSlug": "clinica-xyz",
  "plan": "start|growth|scale|enterprise",
  "createdAt": "2026-07-15T10:00:00Z"
}
```

### Saída: Auditoria automática gerada

```bash
# Tarefa automatizada (GitHub Actions ou cronJob)
1. Aguardar 7 dias de produção (mínimo 20 conversas)
2. Rodar: scripts/generate-replay-cases-from-db.ts --clinic clinica-xyz
3. Rodar: npm run replay:conversas -- --clinic clinica-xyz
4. Gerar relatório estruturado
5. Enviar notificação: "Auditoria de Clinica XYZ pronta para revisão"
6. Salvar em docs/product/client-validation/clinica-xyz-07-2026/
```

### Script master: `scripts/client-validation-pipeline.ts`

```typescript
/**
 * Client Validation Pipeline — Automatiza baseline + report + checklist para qualquer cliente
 * 
 * Uso:
 *   npx tsx scripts/client-validation-pipeline.ts --clinic clinica-xyz --days 7 --limit 20
 * 
 * Output:
 *   1. auditoria-20-conversas.md
 *   2. plano-acao-t+{N}-dias.md (N estimado por volume)
 *   3. executive-summary.html
 *   4. metricas-baseline.json
 */

import { db } from "../src/infrastructure/db/client";
import { organizations, conversations, messages } from "../src/infrastructure/db/schema";
import { eq, desc, gte } from "drizzle-orm";
import fs from "fs";
import path from "path";

interface ClientValidationConfig {
  clinicSlug: string;
  daysOfData: number;
  conversationsLimit: number;
  outputDir: string;
}

async function main() {
  const clinicSlug = process.argv[process.argv.indexOf("--clinic") + 1];
  const daysBack = parseInt(process.argv[process.argv.indexOf("--days") + 1] || "7");
  const limit = parseInt(process.argv[process.argv.indexOf("--limit") + 1] || "20");

  const [clinic] = await db.select()
    .from(organizations)
    .where(eq(organizations.slug, clinicSlug))
    .limit(1);

  if (!clinic) throw new Error(`Clinic ${clinicSlug} not found`);

  console.log(`📊 Iniciando pipeline de validação: ${clinic.name}`);
  console.log(`   Plan: ${clinic.plan} | Volume esperado: ~${clinic.estimatedMonthlyMessages ?? 500}/mês`);

  // STEP 1: Extrair conversas
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const conversationList = await db.select()
    .from(conversations)
    .where(
      gte(conversations.createdAt, cutoffDate) &&
      eq(conversations.clinicId, clinic.id)
    )
    .orderBy(desc(conversations.createdAt))
    .limit(limit);

  console.log(`✓ Encontradas ${conversationList.length} conversas nos últimos ${daysBack} dias`);

  // STEP 2: Gerar casos de replay
  const cases = [];
  for (const conv of conversationList) {
    const msgs = await db.select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(messages.sentAt);

    const leadMessages = msgs.filter(m => m.author === "lead").map(m => m.body);
    if (leadMessages.length === 0) continue;

    cases.push({
      name: `Conversa ${conv.id.slice(0, 8)} (${conv.category})`,
      source: `Real database — ${new Date(conv.createdAt).toLocaleString("pt-BR")}`,
      messages: leadMessages,
      expectIntent: undefined,
    });
  }

  // STEP 3: Rodar replay
  console.log(`\n▶ Rodar replay contra pipeline real...`);
  const { spawn } = require("child_process");
  const replay = spawn("npx", ["tsx", "scripts/replay-conversas.ts", "--clinic", clinicSlug, "--cases-stdin"]);

  replay.stdin.write(JSON.stringify(cases));
  replay.stdin.end();

  let replayOutput = "";
  replay.stdout.on("data", (data: Buffer) => {
    replayOutput += data.toString();
    process.stdout.write(data);
  });

  replay.on("close", async (code: number) => {
    if (code !== 0) {
      console.error(`❌ Replay falhou com código ${code}`);
      process.exit(1);
    }

    // STEP 4: Analisar output e gerar reports
    console.log(`\n📝 Gerando relatórios...`);

    const outputDir = path.join(
      process.cwd(),
      "docs/product/client-validation",
      `${clinicSlug}-${new Date().toISOString().slice(0, 7).replace("-", "-")}`
    );
    fs.mkdirSync(outputDir, { recursive: true });

    // 4a. Auditoria detalhada (MD)
    const auditoriaMd = generateAuditoriaMd(clinic, conversationList, replayOutput);
    fs.writeFileSync(path.join(outputDir, "auditoria-20-conversas.md"), auditoriaMd);

    // 4b. Plano de ação (MD)
    const actionPlan = generateActionPlanMd(clinic, estimateTimelineFromVolume(clinic));
    fs.writeFileSync(path.join(outputDir, "plano-acao.md"), actionPlan);

    // 4c. Sumário executivo (HTML)
    const htmlSummary = generateExecutiveSummaryHtml(clinic, replayOutput);
    fs.writeFileSync(path.join(outputDir, "executive-summary.html"), htmlSummary);

    // 4d. Métricas JSON (para tracking)
    const metrics = parseMetricsFromReplay(replayOutput);
    fs.writeFileSync(path.join(outputDir, "baseline-metrics.json"), JSON.stringify(metrics, null, 2));

    console.log(`✓ Relatórios salvos em: ${outputDir}`);
    console.log(`  - auditoria-20-conversas.md`);
    console.log(`  - plano-acao.md`);
    console.log(`  - executive-summary.html`);
    console.log(`  - baseline-metrics.json`);

    // STEP 5: Notificar time
    await notifyTeamSlack(clinic, outputDir, metrics);

    console.log(`\n✅ Pipeline completo! Próximo passo: Code review dos relatórios.`);
  });
}

function estimateTimelineFromVolume(clinic: any): string {
  const monthlyMsgs = clinic.estimatedMonthlyMessages || 500;
  if (monthlyMsgs < 500) return "3"; // T+3 para clientes pequenos
  if (monthlyMsgs < 2000) return "5"; // T+5 para médios
  return "7"; // T+7 para grandes (como Vitalli 4.300/mês)
}

function generateAuditoriaMd(clinic: any, conversations: any[], replayOutput: string): string {
  // Usar template similar ao de Vitalli, mas generalizado
  return `# Auditoria de Conversação — ${clinic.name}\n\n...`; // Implementação completa
}

function generateActionPlanMd(clinic: any, timelineEstimate: string): string {
  return `# Plano de Ação — ${clinic.name} (T+${timelineEstimate} dias)\n\n...`;
}

function generateExecutiveSummaryHtml(clinic: any, replayOutput: string): string {
  return `<!DOCTYPE html>...<body>...</body></html>`;
}

function parseMetricsFromReplay(output: string): object {
  // Extrair scores, F1/F3/F5 counts, etc
  const metricsRegex = /❌ (\d+) checks? (F\d+)/g;
  const metrics: any = {};
  let match;
  while ((match = metricsRegex.exec(output)) !== null) {
    metrics[match[2]] = parseInt(match[1]);
  }
  return {
    timestamp: new Date().toISOString(),
    baselineScore: 0, // Calcular
    ...metrics,
  };
}

async function notifyTeamSlack(clinic: any, reportPath: string, metrics: any): Promise<void> {
  // POST para Slack: "Auditoria de {clinic.name} pronta"
  // Link: docs/product/client-validation/{path}
  console.log(`📢 [Slack] Auditoria de ${clinic.name} pronta para revisão`);
}

main().catch(console.error);
```

---

## PARTE 4 — TEMPLATE GENÉRICO DE AUDITORIA

### Estrutura reutilizável (não copiar Vitalli hardcoded)

Criar arquivo: `src/application/client-validation/AuditReportGenerator.ts`

```typescript
/**
 * Gera relatório de auditoria padronizado para qualquer clínica
 * 
 * Input: clinicId, conversações (últimas 20), replay output
 * Output: Markdown report estruturado com F1-F10, plano P0-P3
 */

export interface ClientAuditReport {
  clinicName: string;
  clinicPlan: "start" | "growth" | "scale" | "enterprise";
  periodStart: Date;
  periodEnd: Date;
  conversationsAnalyzed: number;
  baselineScore: number;
  failurePatterns: FailurePattern[];
  recommendations: Recommendation[];
  timelineEstimate: "3d" | "5d" | "7d";
}

export interface FailurePattern {
  code: "F1" | "F2" | "F3" | "F4" | "F5" | ... // F1-F10 como em Vitalli
  frequency: number; // % das conversas
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  examples: string[]; // 2-3 exemplos reais
  impact: "vendas" | "experiencia" | "confiabilidade";
}

export interface Recommendation {
  code: "P0.1" | "P0.2" | ... // P0-P3 como em Vitalli
  title: string;
  description: string;
  estimatedDays: number;
  targetReduction: string; // "F1: 50% → 10%"
  blocker: boolean;
  owner: "engenheiro-conversa" | "especialista-infra" | "revisor-multitenant";
}

export class AuditReportGenerator {
  async generate(clinicId: string, limit: number = 20): Promise<ClientAuditReport> {
    // 1. Fetch clinic + conversas
    // 2. Parse replay output
    // 3. Detectar padrões de falha (F1-F10)
    // 4. Calcular frequência, severidade, impacto
    // 5. Montar recomendações (P0-P3)
    // 6. Estimar timeline baseado no volume
    // 7. Retornar report estruturado
  }
}
```

---

## PARTE 5 — TIMELINE DINÂMICA (Baseada em Volume)

### Algoritmo: Estimar T+N baseado em características do cliente

```typescript
function estimateTimeline(clinic: Organization): {
  days: number;
  breakdown: { phase: string; days: number }[];
  bottleneck: string;
} {
  const monthlyMsgs = clinic.estimatedMonthlyMessages || 500;
  const hasPlaybook = clinic.playbookText ? true : false;
  const hasOperator = clinic.operatorCount || 0 > 0;
  const region = clinic.timezone; // Timezone hints at region/language complexity

  let totalDays = 0;
  const breakdown = [];

  // Phase A: Baseline (always 1 day)
  breakdown.push({ phase: "A — Baseline", days: 1 });
  totalDays += 1;

  // Phase B: Implementation (scales with volume)
  let implDays = 2; // P0.1 (always critical)
  if (monthlyMsgs > 2000) implDays += 1; // P0.2, P0.3 needed
  if (!hasPlaybook) implDays += 1; // Need to create playbook first
  breakdown.push({ phase: "B — Implementation", days: implDays });
  totalDays += implDays;

  // Phase C: E2E (always 1 day, parallel with B)
  // (não soma, é paralelo)

  // Phase D: Go-live (1 day)
  breakdown.push({ phase: "D — Go-live", days: 1 });
  totalDays += 1;

  return {
    days: Math.max(3, Math.min(7, totalDays)),
    breakdown,
    bottleneck: !hasPlaybook ? "Playbook precisa ser criado primeiro" : implDays > 3 ? "Volume alto, mais P0s necessários" : "None",
  };
}
```

**Exemplos**:
- **Clínica pequena** (200 msgs/mês, playbook pronto, 1 operador) → T+3 dias
- **Clínica média** (800 msgs/mês, playbook parcial) → T+5 dias
- **Clínica grande** (4.300 msgs/mês, sem playbook) → T+7 dias (como Vitalli)

---

## PARTE 6 — CHECKLIST DE GO-LIVE GENÉRICO

### Template reutilizável

```markdown
# Go-Live Checklist — [Clinic Name]

## PRÉ-DECISÃO (T+N-1)

- [ ] Baseline capturado em `reports/[clinic]-baseline.json`
- [ ] P0.x PRs ALL reviewadas por revisor-multitenant
- [ ] [Clinic] replay score ≥ 85%
- [ ] Ximendes + NC Beauty (ou latest clinic) sem regressão
- [ ] E2E com operador local: 5/5 conversas OK
- [ ] Caps + quiet hours aplicadas (se relevante)
- [ ] Sentry + Analytics dashboard ativo
- [ ] Rollback procedure documentado
- [ ] Slack channel #[clinic]-live criado
- [ ] Team briefing complete

## GO-LIVE (T+N, horário local da clínica)

- [ ] Shadow mode desligado no banco (organizations.channel_mode = 'live')
- [ ] Sentry event enviado: "[Clinic] shadow mode disabled → LIVE"
- [ ] Operador notificado (WhatsApp / SMS)
- [ ] Monitoring ativo por 1 hora (errors/min, response time)
- [ ] First 5 conversations monitoradas em detalhe

## PÓS-GO-LIVE (T+N até T+N+7)

- [ ] Daily monitoring report (Sentry + Analytics)
- [ ] Manual intervention rate < target % (clinic-specific)
- [ ] No crashes in first week
- [ ] Lead satisfaction score (NPS) collected
- [ ] Operador feedback na tag `validation:[clinic]`

## GO/NO-GO DECISION

**GO** se: Score ≥ 85% + E2E OK + No blockers  
**HOLD** se: Score < 85% or E2E pending  
**ROLLBACK** se: Errors/min > 5 for 10 min OR manual intervention > 30%

---
```

---

## PARTE 7 — MÉTRICAS PADRONIZADAS POR CLIENTE

### Dashboard de tracking (template)

```json
{
  "clinic": {
    "id": "...",
    "name": "Clínica XYZ",
    "plan": "scale",
    "estimatedMonthlyMessages": 1500
  },
  "validation": {
    "startDate": "2026-07-15",
    "baselineScore": 0.62,
    "targetScore": 0.85,
    "timelineEstimated": "5 days",
    "phases": {
      "A_baseline": { "status": "completed", "daysSpent": 1 },
      "B_implementation": { "status": "in_progress", "daysSpent": 2, "daysEstimated": 3 },
      "C_e2e": { "status": "pending", "daysEstimated": 1 },
      "D_go_live": { "status": "pending", "daysEstimated": 1 }
    }
  },
  "failures": {
    "F1_greeting": { "baseline": 12, "current": 3, "target": 2 },
    "F2_batches": { "baseline": 5, "current": 2, "target": 0 },
    "F3_ambiguous": { "baseline": 4, "current": 1, "target": 0 },
    "F5_content": { "baseline": 6, "current": 0, "target": 0 }
  },
  "go_live": {
    "decision": "pending",
    "reason": "Aguardando E2E",
    "decidedAt": null,
    "liveAt": null
  }
}
```

**Visualizar com**: Dashboard em Grafana / Tableau / Google Sheets

---

## PARTE 8 — DOCUMENTAÇÃO POR CLIENTE (TEMPLATE)

### Arquivo: `docs/product/client-validation/_template/README.md`

```markdown
# Validação — [Clinic Name] — [Period YYYY-MM]

**Dono**: [Tech lead]  
**Operador local**: [Name]  
**Data início**: [ISO date]  
**Target de conclusão**: [ISO date, T+N]

---

## Documentos principais

1. **auditoria-20-conversas.md** — Análise caso a caso (20 conversas reais)
2. **plano-acao-t+N-dias.md** — Timeline dia a dia com tarefas
3. **executive-summary.html** — Visual para stakeholders
4. **baseline-metrics.json** — Métricas estruturadas para tracking

---

## Quick links

- Baseline score: [LINK para metric]
- Replay logs: [LINK para logs]
- Slack channel: [#clinic-live]
- Jira epic: [LINK]

---

## Status

- [ ] Phase A (Baseline) — DONE / IN PROGRESS / PENDING
- [ ] Phase B (Implementation) — DONE / IN PROGRESS / PENDING
- [ ] Phase C (E2E) — DONE / IN PROGRESS / PENDING
- [ ] Phase D (Go-live) — DONE / IN PROGRESS / PENDING

---

## Lições aprendidas

[Preenchido após go-live]

---
```

---

## PARTE 9 — AUTOMAÇÃO: GITHUB ACTIONS

### Workflow: Validação automática a cada 7 dias

**Arquivo**: `.github/workflows/client-validation-check.yml`

```yaml
name: Client Validation Check

on:
  schedule:
    # Toda segunda-feira 09:00 UTC
    - cron: '0 9 * * 1'
  workflow_dispatch:
    inputs:
      clinic_slug:
        description: 'Clinic slug to validate (e.g., vitalli, ximendes)'
        required: true

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run client validation pipeline
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          CLINIC="${{ github.event.inputs.clinic_slug || 'all' }}"
          npx tsx scripts/client-validation-pipeline.ts --clinic $CLINIC --days 7 --limit 20
      
      - name: Upload reports
        uses: actions/upload-artifact@v3
        with:
          name: validation-reports-${{ github.event.inputs.clinic_slug }}
          path: docs/product/client-validation/
      
      - name: Notify on Slack
        run: |
          npx tsx scripts/slack-notify-validation.ts \
            --clinic ${{ github.event.inputs.clinic_slug }} \
            --status success

      - name: Create GitHub Issue if needed
        if: failure()
        run: |
          gh issue create \
            --title "Validation failed for clinic ${{ github.event.inputs.clinic_slug }}" \
            --body "See artifacts for details" \
            --label "validation"
```

---

## PARTE 10 — ROADMAP: COMO ESCALAR

### T+0 (Agora — Vitalli): Piloto
- ✓ Documentar tudo em 4 arquivos (auditoria, plano, summary, checklist)
- ✓ Script de replay + analysis
- ✓ E2E com Gleice
- ✓ Go-live em T+7

### T+30 (Agosto): Vitalli + Ximendes + NC Beauty
- Retroativamente auditar Ximendes (já tem dados, não esperar 7 dias)
- Rodar NC Beauty (já está em shadow mode, tem dados)
- Aplicar P0.1-P0.6 a todas 3
- Validar que template funciona para diferentes tamanhos de clínica

**Saída**: Template validado, 3 clínicas em produção com qualidade

### T+60 (Setembro): Template finalizado
- GitHub Actions rodando automaticamente
- Dashboard de tracking centralizado
- Documentação pública em `docs/product/client-validation/`
- Treinamento de tech lead (como aplicar template)

**Saída**: Process de validação é parte do onboarding normal

### T+90 (Outubro): Escala N clínicas
- Qualquer novo cliente automaticamente auditado em T+7
- Score 85%+ garantido antes de go-live
- Operador local integrado no processo E2E
- Histórico de validações rastreável

---

## PARTE 11 — RISK MANAGEMENT: QUANDO ALGO FALHA

### Cenário 1: Cliente grande (5.000 msgs/mês) precisa de T+10 (não T+7)

**Ação**:
- Estimar realista no início (algoritmo de volume em Parte 5)
- Não forçar T+7; comunicar T+10 ao cliente
- Priorizar P0.1 (sempre crítica) vs P0.2-P0.6 (adaptável)

### Cenário 2: Cliente com playbook muito customizado (não encaixa template)

**Ação**:
- Usar template como base, mas adicionar "P0.custom" para customizações
- Documentar em `playbook-custom-adjustments.md`
- Revisor-multitenant valida que custom não quebra CORE

### Cenário 3: Operador local não disponível para E2E

**Ação**:
- Atrasar E2E para quando operador estiver disponível
- Não pular E2E (é critical para validação)
- Alternativa: Remote E2E com tech lead (menos ideal, mas possível)

### Cenário 4: Replay score não melhora com fixes

**Ação**:
- Investigar: P0.x está realmente implementado? Testar localmente.
- Investigar: Playbook do cliente tem dados incompletos? Validar no banco.
- Investigar: Problema não é de IA, é de dados? Adicionar `P0.data` (enriquecer conteúdo)
- Decisão: Rollback + replan

---

## PARTE 12 — INTEGRAÇÃO COM ONBOARDING COMERCIAL

### Novo fluxo de venda (com validação integrada)

```
VENDA                                       ONBOARDING + VALIDAÇÃO
└─ Prospect entra                           └─ Criar clínica no banco
   └─ Demo                                     └─ Ativar em shadow mode
      └─ Proposta aprovada                     └─ Aguardar 7 dias de dados
         └─ Contrato assinado                  └─ Auto-auditoria (GitHub Actions)
            └─ Kickoff                         └─ Report gerado automaticamente
               └─ NOVO: Validação integrada    └─ Tech lead revisa
                  └─ E2E com operador          └─ Ação: Merge P0.x ou custom setup
                     └─ Go-live                └─ E2E com operador local
                        └─ Monitoramento       └─ Go-live com garantia
```

**Checkpoint de venda**: "Validação de qualidade é parte do contrato"

---

## PARTE 13 — DOCUMENTAÇÃO PARA NOVO TECH LEAD

### Arquivo: `docs/operations/client-validation-runbook.md`

Essência (1 página de quick reference):

```markdown
# Client Validation Runbook

## 1️⃣ Novo cliente entra (recém criado em shadow mode)

```bash
# Aguardar 7 dias (mínimo 20 conversas)
# Então rodar:
npx tsx scripts/client-validation-pipeline.ts --clinic {clinic_slug} --days 7 --limit 20
```

## 2️⃣ Revisar relatório

- Abrir `docs/product/client-validation/{clinic}-YYYY-MM/`
- Ler `auditoria-20-conversas.md` (failures, exemplos)
- Ler `plano-acao.md` (timeline, P0.x, responsáveis)

## 3️⃣ Tomar decisão

- Score < 85%? → Implementar P0.x no plano
- Score ≥ 85%? → Validar retroativamente (Ximendes) + E2E → Go-live

## 4️⃣ Implementar (si necessário)

- Branch: `feat/{client}-p01-anti-greeting`
- Test: `npm run replay:conversas -- --clinic {client}`
- Validate: Ximendes sem regressão
- Merge: Quando revisor-multitenant OK

## 5️⃣ E2E com operador

- 5 conversas reais no WhatsApp
- Checklist: Preço, agendamento, manutenção, crashes
- Feedback em Sentry com tag `validation:{clinic}`

## 6️⃣ Go-live

- Se OK: Desligar shadow mode
- Monitorar 24h: errors/min, response time, manual intervention %
- Se alguma métrica > threshold: Rollback automático

---

## Templates

- Auditoria: `docs/product/client-validation/_template/auditoria-20-conversas.md`
- Plano: `docs/product/client-validation/_template/plano-acao.md`
- Checklist: `docs/product/client-validation/_template/checklist.md`

---
```

---

## CONCLUSÃO: O Que Você Ganha ao Escalar

| Antes (Manual) | Depois (Template) |
|---|---|
| ❌ Cada cliente é "case único" | ✅ Template reutilizável em 15 min |
| ❌ Auditorias ad-hoc | ✅ Automático a cada 7 dias |
| ❌ Métricas em planilha Excel | ✅ Dashboard centralizado |
| ❌ Risco de "mexer e rezar" | ✅ Garantia 85%+ antes de go-live |
| ❌ Sem rastreabilidade de lições | ✅ Histórico completo por cliente |
| ❌ Operador local desconectado | ✅ E2E integrado no processo |
| ❌ Sem escalabilidade para N clientes | ✅ Suporta 100s de clientes |

---

## PRÓXIMOS PASSOS

### Phase 1 — Vitalli (T até T+7)
- ✅ Validação manual com 3 documentos
- ✅ E2E com Gleice
- ✅ Go-live em T+7

### Phase 2 — Template (T+7 até T+30)
- Implementar script `client-validation-pipeline.ts`
- Criar GitHub Actions workflow
- Documentar runbook para tech lead
- Testar em Ximendes + NC Beauty (retroativo)

### Phase 3 — Automação (T+30 até T+60)
- Dashboard de tracking (Grafana)
- Auto-notificações Slack
- Auto-issue criação no Jira

### Phase 4 — Escalabilidade (T+60+)
- Qualquer novo cliente roda o template
- Score 85%+ antes de go-live, sempre
- Operador local sempre integrado
- Histórico consultável

---

**Assinado**: Estratégia de escalabilidade para validação de clientes  
**Aplicável a**: Vitalli (piloto), Ximendes, NC Beauty, e future clients  
**ROI**: 1 template = N clientes com qualidade garantida

---

Este playbook é **VIVO**. Após Vitalli, update com lessons learned e iterativamente melhora para próximos clientes.
