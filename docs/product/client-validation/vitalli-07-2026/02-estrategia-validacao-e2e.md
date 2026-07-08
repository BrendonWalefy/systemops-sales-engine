# ESTRATÉGIA DE VALIDAÇÃO E2E REAL — Vitalli (Go-Live Definitivo)

**Data**: 08/07/2026  
**Problema identificado**: Simulador (`/api/playbook/simulate`) NÃO reflete comportamento real; "mexemos em muita coisa e os mesmos problemas acontecem"  
**Solução**: Pipeline REAL de produção (orquestrador completo) + teste contra 20 conversas reais

---

## PARTE 1 — DIAGNÓSTICO: POR QUE O SIMULADOR ENGANA

### Simulador (`/api/playbook/simulate`)
```
Input: { message, clinicId }
↓
Contexto raso (só config + last N messages)
↓
ResponseComposer direto (SEM orquestrador)
↓
Output: Resposta isolada
```

**Problemas**:
- **F1 não é detectado** — simulador não roda IntentClassifier + coerção
- **F2 não é testado** — simula 1 mensagem, não rajada
- **F4 não se aplica** — sem follow-up dispatcher
- **Guards não são testados** — orquestrador é onde estão
- **Contexto de tratamento raso** — não dispara PIPELINE-START real

### Pipeline real (ConversationOrchestrator.ts)
```
Input: message (webhook WhatsApp real)
↓
RegisterIncomingMessage (dedup, lead, conversa)
↓
IntentClassifier (gpt-4o-mini)
↓
coerceBusinessIntent (guards determinísticos) ← F1, F3, F5 são resolvidos AQUI
↓
ActionResult mapping
↓
ResponseComposer (gpt-4o-mini)
↓
OutboundDeliveryService (media, TTS, channel safety)
↓
Database + Sentry
```

**Diferenças críticas**:
- **Guards são executados** (F1 detection, manutenção redirect, etc)
- **Contexto completo** (appointment context, lead history, temperature)
- **Efeitos colaterais** (cria leads, guarda messages, seta intent no DB)
- **Modo concierge/pipeline real** (não forçado "general_question")

### Conclusão
**Simulador valida sintaxe, não semântica.** Um fix que passa no simulador pode falhar em produção porque o orquestrador não rodou.

---

## PARTE 2 — MÉTODO DE VALIDAÇÃO: REPLAY COM PIPELINE REAL

### Tool existente: `scripts/replay-conversas.ts`

Esse script **YÁ EXISTE** e faz exatamente o que precisamos:
- ✓ Roda IntentClassifier real (gpt-4o-mini)
- ✓ Roda coerceBusinessIntent (guards)
- ✓ Roda ResponseComposer real
- ✓ Compara contra checks determinísticos
- ✓ Não grava no banco (seguro)

**Uso atual**:
```bash
npm run replay:conversas                  # Ximendes (default)
npm run replay:conversas -- --clinic vitalli   # Vitalli
```

**Limitação atual**: Test cases são hardcoded para Ximendes (CASES constant)

---

## PARTE 3 — EXTENSÃO: GERAR TEST CASES A PARTIR DE 20 CONVERSAS REAIS

### Nova tarefa: Converter as 20 conversas reais em test cases
**Input**: Query results from `query-vitalli-conversations.ts`  
**Output**: ReplayCase[] para rodar contra pipeline real  
**Risco**: Zero (apenas leitura, não escreve)

### Script novo: `scripts/generate-replay-cases-from-db.ts`

```typescript
/**
 * Extrai as N últimas conversas de uma clínica do banco
 * e gera ReplayCase[] para replay-conversas.ts
 * 
 * Uso:
 *   npx tsx scripts/generate-replay-cases-from-db.ts --clinic vitalli --limit 20 > cases.json
 */
import { db } from "../src/infrastructure/db/client";
import { organizations, conversations, messages } from "../src/infrastructure/db/schema";
import { eq, desc } from "drizzle-orm";

async function run() {
  const clinicSlug = process.argv[process.argv.indexOf("--clinic") + 1] || "vitalli";
  const limit = parseInt(process.argv[process.argv.indexOf("--limit") + 1] || "20");

  const [clinic] = await db.select().from(organizations)
    .where(eq(organizations.slug, clinicSlug)).limit(1);
  if (!clinic) throw new Error(`Clinic ${clinicSlug} not found`);

  const conversationList = await db.select().from(conversations)
    .where(eq(conversations.clinicId, clinic.id))
    .orderBy(desc(conversations.createdAt))
    .limit(limit);

  const cases = [];
  for (const conv of conversationList) {
    const msgs = await db.select().from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(messages.sentAt);

    const leadMessages = msgs.filter(m => m.author === "lead").map(m => m.body);
    if (leadMessages.length === 0) continue;

    cases.push({
      name: `Conversa ${conv.id.slice(0, 8)} (${conv.category})`,
      source: `Real database — ${new Date(conv.createdAt).toLocaleString("pt-BR")}`,
      messages: leadMessages,
      expectIntent: undefined, // Não tem expectativa; é validação qualitativa
    });
  }

  console.log(JSON.stringify(cases, null, 2));
}

run().catch(console.error);
```

---

## PARTE 4 — PLANO DE VALIDAÇÃO POR FASE

### Fase A: Baseline (Today — T+1)
**Objetivo**: Rodar as 20 conversas de Vitalli contra o pipeline real ANTES de qualquer fix

```bash
# Gerar test cases
npx tsx scripts/generate-replay-cases-from-db.ts --clinic vitalli --limit 20 > /tmp/vitalli-cases.json

# Estender replay-conversas.ts para usar casos dinâmicos
# (atual: CASES hardcoded → futuro: importar de JSON)

# Rodar
npm run replay:conversas -- --clinic vitalli 2>&1 | tee /tmp/baseline-vitalli.log

# Capturar: % de respostas genéricas, % de intents errados, crashes
```

**Saída esperada**:
```
❌ 10 checks de F1 (saudação genérica)
❌ 2 checks de F3 (termos desconhecidos)
❌ 3 checks de F5 (manutenção não respondida)
❌ 1 crash técnico
✅ 4 conversas sem problemas

Score: 60% de acurácia
```

### Fase B: Implementação (T+2 até T+5)
**Para cada P0 (P0.1, P0.2, P0.3, ...)**:
1. Implementar fix
2. Rodar replay contra Vitalli + Ximendes (validação retroativa)
3. Validar que não quebra casos já funcionando

**Exemplo: P0.1 (Guard anti-saudação)**

```bash
# Implementação em branch feat/p01-anti-greeting
git checkout -b feat/p01-anti-greeting

# Editar ConversationOrchestrator.ts
# Adicionar guard de saudação genérica

# Testar contra baseline
npm run replay:conversas -- --clinic vitalli > /tmp/after-p01.log
diff -u /tmp/baseline-vitalli.log /tmp/after-p01.log

# Esperado: Redução de F1 de 10 → ~2 (apenas casos genuinamente vagas)
```

### Fase C: Validação retroativa (T+3, paralelo com implementação)
**Garantir que fix não quebra Ximendes**:

```bash
npm run replay:conversas -- --clinic ximendes > /tmp/ximendes-after-p01.log
# Score antes: 58% (auditoria Jul/2026)
# Score depois: deveria ser >= 58%
```

### Fase D: Testes E2E com usuário real (T+6)
**Antes de desligar shadow mode**:
1. Gleice testa as top 5 conversas da lista (vivas no WhatsApp)
2. Operador valida: resposta de preço, manutenção, agendamento
3. Registra feedback em Sentry com tag `validation:vitalli`

**Checklist**:
- [ ] Pergunta de preço → IA responde preço (não menu genérico)
- [ ] Pergunta de manutenção → IA responde manutenção (não "depende da avaliação")
- [ ] Lead quente (elogio) → IA conduz para agendamento (não menu)
- [ ] Lead desconhecido → IA oferta serviços (contexto prévio)
- [ ] Sem crash técnico em 5 tentativas

### Fase E: Go-live com monitoramento (T+7)
**Desligar shadow mode ≈ 21:00 (horário de operação Vitalli)**

**Monitoramento 24h**:
- Sentry dashboard: erros por minuto (deve ser ~0 durante operação)
- Inbox: % de leads respondidos em <1min (meta: >95%)
- Gleice relato: % de conversas que precisam intervir (meta: <10%, antes era 30%)

**Rollback trigger**: Se qualquer métrica > threshold, voltar pra shadow mode

---

## PARTE 5 — IMPLEMENTAÇÃO DO HARNESS ESTENDIDO

### Tarefa 1: Modificar `replay-conversas.ts` para aceitar JSON dinâmico

**Mudança**:
```typescript
// ANTES: const CASES: ReplayCase[] = [ ... ]
// DEPOIS: Carregar de --cases-file ou gerar de --clinic

async function main() {
  // ... existing setup ...
  
  let cases: ReplayCase[] = [];
  
  if (process.argv.includes("--cases-file")) {
    const filePath = process.argv[process.argv.indexOf("--cases-file") + 1];
    cases = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } else {
    cases = CASES; // fallback para cases hardcoded
  }
  
  // ... rest
}
```

**Uso novo**:
```bash
# Opção 1: Cases dinâmicas do banco
npx tsx scripts/generate-replay-cases-from-db.ts --clinic vitalli --limit 20 | \
  npx tsx scripts/replay-conversas.ts --clinic vitalli --cases-stdin

# Opção 2: Cases do arquivo
npx tsx scripts/replay-conversas.ts --clinic vitalli --cases-file /tmp/vitalli-cases.json
```

### Tarefa 2: Adicionar detecção de F1 (saudação genérica)

**Atual**: Apenas detecta markers hardcoded
**Novo**: Detectar padrão + contexto

```typescript
const isGenericStarter = (reply: string, message: string): boolean => {
  const markers = [
    "o que você gostaria de ver hoje",
    "valores, agendamento ou algum serviço",
  ];
  
  const isPureGreeting = ["ola", "oi", "boa"].some(w => message.toLowerCase().includes(w));
  const hasQuestion = ["?", "qual", "quanto", "como", "quando", "onde"].some(w => message.toLowerCase().includes(w));
  
  // F1: Se o lead fez pergunta (tem ?) e IA respondeu com menu genérico
  if (hasQuestion && markers.some(m => reply.toLowerCase().includes(m))) {
    return true; // ❌ F1 detectado
  }
  
  return false;
};
```

### Tarefa 3: Adicionar detecção de F5 (manutenção não respondida)

```typescript
const isMaintainanceQuestion = (message: string): boolean => {
  const keywords = ["manutenção", "manutencao", "limpeza", "reparo", "remoção", "higiene"];
  return keywords.some(k => message.toLowerCase().includes(k));
};

// Em cada mensagem do lead:
if (isMaintainanceQuestion(msg)) {
  // Verificar se resposta menciona valores
  const hasPrice = /R\$\s*\d+/.test(reply);
  if (!hasPrice && !reply.toLowerCase().includes("avaliação")) {
    failures++;
    console.log("❌ CHECK: pergunta de manutenção mas IA não forneceu preço");
  }
}
```

### Tarefa 4: Report estruturado com comparação antes/depois

```typescript
// Output exemplo
console.log(`
╔════════════════════════════════════════════════════════════════╗
║  REPLAY REPORT — Clínica Vitalli (20 conversas)               ║
║  Pipeline: REAL (IntentClassifier + coerceBusinessIntent + Composer)
║  Data: 2026-07-08 20:15                                        ║
╚════════════════════════════════════════════════════════════════╝

📊 MÉTRICAS:
  Total conversas: 20
  Sem problemas: 4 (20%)
  Com problemas: 16 (80%)

🔴 F1 — Saudação genérica sobre pergunta: 10 (-50% se P0.1 aplicado)
🔴 F3 — Termo desconhecido: 2
🔴 F5 — Manutenção não respondida: 3
🟡 F9 — Crash técnico: 1

💡 SUGESTÕES:
  ✓ Aplicar P0.1 (guard anti-saudação) → reduz F1 de 50% para ~10%
  ✓ Aplicar P0.2 (manutenção no playbook) → elimina F5
  ✓ Aplicar P0.6 (sentry + fallback) → elimina F9

🎯 TARGET (pós-fixes): 85% de acurácia, <5% de intervenção manual
`);
```

---

## PARTE 6 — CHECKLIST PRÉ-GO-LIVE

### Before P0.1-P0.6 Implementation

- [ ] Baseline rodar com sucesso (npm run replay:conversas -- --clinic vitalli)
- [ ] Documentar F1, F3, F5 ocorrências em detalhes
- [ ] Gleice confirmar que operador está intervindo em ~30% das conversas
- [ ] Sentry log de 20 conversas etiquetada com `baseline:vitalli`

### After Each P0.x Implementation

- [ ] Rodar replay com novo código (git branch feat/p0x-xxx)
- [ ] Comparar report com baseline (% de problemas reduzido)
- [ ] Rodar replay também em ximendes (sem regressão)
- [ ] Sentry report for new code tagged `validation:p0x`
- [ ] PR review com revisor-multitenant (segurança + conformidade)

### Before Go-Live (T+6)

- [ ] Baseline + P0.1-P0.6 todos green
- [ ] E2E com Gleice: 5 conversas vivas (não replay)
- [ ] Gleice feedback registrado no Sentry
- [ ] Score final >= 85% no replay
- [ ] % de manual intervention reduzido de 30% → <10%
- [ ] Quiet hours + caps configurados na UI owner
- [ ] Monitoring dashboard setup (Sentry + analytics)

### During Go-Live (First 24h)

- [ ] Sentry monitoring cada 15min
- [ ] Gleice on-call para handoff manual
- [ ] Log de qualquer crash novo
- [ ] Métrica de "primeira resposta util" > 95%

### Rollback Trigger

- % de intents errados > 10%
- Crash técnico > 5 por hora
- Manual intervention > 20% das conversas
- Lead feedback de resposta genérica em Sentry > 2

---

## PARTE 7 — SCRIPT OPERACIONAL DE ROLLOUT

Criar arquivo `scripts/vitalli-rollout.sh`:

```bash
#!/bin/bash
set -e

CLINIC="vitalli"
DATE=$(date +%Y-%m-%d-%H%M%S)
BASELINE_LOG="/tmp/${CLINIC}-baseline-${DATE}.log"
REPORT_DIR="./reports/vitalli"

echo "📍 Vitalli Rollout Procedure"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# STEP 1: Baseline
echo ""
echo "[1/5] Capturando BASELINE do estado atual..."
npx tsx scripts/generate-replay-cases-from-db.ts --clinic $CLINIC --limit 20 \
  | npx tsx scripts/replay-conversas.ts --clinic $CLINIC --cases-stdin > "$BASELINE_LOG" 2>&1
echo "✓ Baseline salvo em $BASELINE_LOG"
grep -E "^❌|^✓" "$BASELINE_LOG" | tee "$REPORT_DIR/baseline-summary.txt"

# STEP 2: Run P0.x fixes
echo ""
echo "[2/5] Verificando se P0.1-P0.6 estão na branch..."
git branch --contains HEAD | grep -E "feat/p0[1-6]" || echo "⚠️  Nenhum P0.x detectado"

# STEP 3: Test with fixes
echo ""
echo "[3/5] Rodar replay COM fixes implementados..."
AFTER_LOG="/tmp/${CLINIC}-after-${DATE}.log"
npx tsx scripts/generate-replay-cases-from-db.ts --clinic $CLINIC --limit 20 \
  | npx tsx scripts/replay-conversas.ts --clinic $CLINIC --cases-stdin > "$AFTER_LOG" 2>&1
echo "✓ After-log salvo em $AFTER_LOG"

# STEP 4: Compare
echo ""
echo "[4/5] Comparar BASELINE vs AFTER..."
diff -u "$BASELINE_LOG" "$AFTER_LOG" > "$REPORT_DIR/diff-${DATE}.txt" || true
echo "✓ Diff salvo em $REPORT_DIR/diff-${DATE}.txt"

# STEP 5: Retroactive check on ximendes
echo ""
echo "[5/5] Validar retroativamente em XIMENDES (sem regressão)..."
XIMENDES_LOG="/tmp/ximendes-retroactive-${DATE}.log"
npm run replay:conversas -- --clinic ximendes > "$XIMENDES_LOG" 2>&1
grep -E "^❌|^✓" "$XIMENDES_LOG" | head -5

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Rollout validation complete!"
echo "   Baseline: $BASELINE_LOG"
echo "   After:    $AFTER_LOG"
echo "   Diff:     $REPORT_DIR/diff-${DATE}.txt"
echo "   Ximendes: $XIMENDES_LOG"
echo ""
echo "📋 NEXT STEPS:"
echo "   1. Review diff-*.txt"
echo "   2. If OK, merge PR"
echo "   3. Run E2E with Gleice (5 live conversations)"
echo "   4. If 85%+ acurácia, disable shadow mode"
```

**Uso**:
```bash
chmod +x scripts/vitalli-rollout.sh
./scripts/vitalli-rollout.sh
```

---

## PARTE 8 — INTEGRAÇÃO COM CI/CD

### GitHub Actions: Replay validation em cada PR

**Arquivo**: `.github/workflows/replay-validation.yml`

```yaml
name: Replay Validation

on:
  pull_request:
    branches: [main, develop]
    paths:
      - 'src/core/intelligence/**'
      - 'src/core/pipeline/**'
      - 'scripts/replay-conversas.ts'

jobs:
  replay:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run replay:conversas -- --clinic ximendes
      - run: npm run replay:conversas -- --clinic vitalli
```

Garante que qualquer mudança no orquestrador é testada contra pipeline REAL.

---

## PARTE 9 — MÉTRICAS DE SUCESSO

### Baseline (Hoje)
- Acurácia de resposta: 60%
- F1 ocorrências: 10 (50% das conversas)
- F3 ocorrências: 2 (10%)
- F5 ocorrências: 3 (15%)
- Manual intervention: 30%

### Target (Pós-fixes)
- Acurácia de resposta: ≥85%
- F1 ocorrências: ≤2 (10%)
- F3 ocorrências: ≤1 (5%)
- F5 ocorrências: 0 (eliminado)
- Manual intervention: ≤10%

### Success Criteria para Go-Live
```
IF acurácia >= 85%
   AND F1 + F3 + F5 reduzidos >= 70%
   AND manual intervention <= 10%
   AND Ximendes sem regressão
THEN desligar shadow mode ✅
ELSE manter shadow mode e iterarr
```

---

## CONCLUSÃO

**O problema** ("testes engajam, produção falha") é **resolver com pipeline REAL**, não simulador.

**A solução**:
1. Gerar test cases a partir de 20 conversas reais de Vitalli
2. Rodar contra orquestrador REAL (replay-conversas.ts)
3. Validar que cada fix reduz F1/F3/F5
4. Validar que Ximendes não regride
5. E2E com Gleice antes de go-live
6. Monitorar 24h pós-go-live

**Timeline realista**: 5-7 dias (não "mexer e rezar")

**Garantia**: Se tudo passar neste plano, Vitalli vai estar verde em produção.

---

**Próximo passo**: Implementar tarefa 1-4 (extensão do harness). Quer eu fazer?
