# PLANO DE AÇÃO — Vitalli Excelência | T+7 dias até Go-Live

**Dono**: Brendon  
**Período**: 08/07 (T) até 14/07 (T+6, go-live em T+7)  
**Compromisso**: Score 85%+ no replay, go-live com garantia de qualidade

---

## 🎯 VISÃO GERAL (2 min)

| Fase | O que | Quem | Duração | Blocker |
|------|-------|------|---------|---------|
| **A** | Baseline + report | Brendon + engenheiro | 1 dia | Nenhum |
| **B1** | P0.1 (anti-saudação) | engenheiro-conversa | 2 dias | Nenhum |
| **B2** | P0.2 (manutenção) | engenheiro-conversa | 1 dia | B1 ~30% pronto |
| **B3** | P0.3 (UI de caps) | especialista-infra | 2 dias | Paralelo com B1 |
| **B4** | P0.5 + P0.6 (minor fixes) | engenheiro-conversa | 1 dia | B1/B2 green |
| **C** | Validação E2E + Gleice | Brendon + Gleice | 1 dia | B1-B4 green |
| **D** | Go-live + monitoramento | Operações 24h | 1 dia | C green |

**Caminho crítico**: B1 (2 dias) → outros em paralelo

---

## 📋 SEMANA 1: Implementação (T até T+5)

### SEGUNDA-FEIRA 08/07 (T) — BASELINE + STRATEGY

#### 09:00-11:00 → Fase A: Capturar baseline
**Tarefas**:
```bash
# Gerar test cases das 20 conversas reais
npx tsx scripts/generate-replay-cases-from-db.ts --clinic vitalli --limit 20 \
  > /tmp/vitalli-20-cases.json

# Rodar replay com pipeline REAL
npm run replay:conversas -- --clinic vitalli --cases-file /tmp/vitalli-20-cases.json \
  2>&1 | tee /tmp/baseline-08-07.log

# Capturar scores
grep -E "^❌|^✓|Resultado:" /tmp/baseline-08-07.log | tee ./reports/vitalli-baseline.txt
```

**Esperado**:
- 10 ❌ F1 (saudação genérica)
- 2 ❌ F3 (termos desconhecidos)
- 3 ❌ F5 (manutenção)
- 1 ❌ F9 (crash)
- **Score: 60%**

**Owner**: Brendon  
**Saída**: `./reports/vitalli-baseline.txt` + `/tmp/baseline-08-07.log`

#### 11:00-12:00 → Revisor-multitenant review
**Reunião de 30 min com revisor**:
- Validar que baseline reflete realidade de Gleice (30% intervenção)
- Confirmar escopo de P0.1-P0.6
- Validar que testes não quebram segurança
- Sign-off na estratégia

**Owner**: revisor-multitenant  
**Saída**: Approval para implementação

#### 14:00-17:00 → Planejamento de sprint
**Reunião de engenharia (1h)**:
- Distribuir P0.1-P0.6 entre engenheiros
- Confirmar prazos (B1 = 2 dias CRÍTICA)
- Setup de branches (feat/p01-*, feat/p02-*, etc)
- Definir "done" para cada P0 (replay green + ximendes sem regressão)

**Owner**: Tech lead  
**Saída**: Jira issues criadas, branches prontas

---

### TERÇA-FEIRA 09/07 (T+1) — IMPLEMENTAÇÃO P0.1-P0.3 (Paralelo)

#### Branch 1: `feat/p01-anti-greeting` (P0.1 — Guard anti-saudação) · CRÍTICA

**Quem**: engenheiro-conversa (prioridade alta)  
**Tempo estimado**: 8h (dia inteiro)  

**Tarefas**:

1. **Editar `src/core/pipeline/ConversationOrchestrator.ts`** (~2h)
   - Adicionar função: `detectBusinessQuestionInMessage(msg: string): boolean`
   - Keywords: "?", "qual", "quanto", "como", "quando", "onde", "valor", "preço", etc
   - **Não** apenas uma busca por "?" — também reconhecer "Qual o valor de lentes" sem "?"
   
   ```typescript
   function detectBusinessQuestion(msg: string): boolean {
     const businessKeywords = [
       // Pergunta de preço
       "valor", "preço", "custa", "quanto", "quanto custa",
       // Pergunta de agendamento
       "agendar", "horário", "disponível", "quando", "que horas",
       // Pergunta de serviço
       "lentes", "facetas", "manutenção", "limpeza", "implante", "prótese",
       // Tratamentos específicos
       "resina", "clareamento", "canal", "exodontia", "gengivoplastia", "botox",
       // Meta markers
       "?" // Tem interrogação
     ];
     
     const normalized = msg.toLowerCase();
     return businessKeywords.some(k => normalized.includes(k));
   }
   ```

2. **Adicionar guard em `coerceBusinessIntent`** (~1h)
   ```typescript
   // Antes de retornar o intent final:
   if (detectBusinessQuestion(message) && finalIntent === "greeting") {
     // Converter greeting em general_question (não vai rodar saudação genérica)
     return "general_question";
   }
   ```

3. **Testes** (~3h)
   - Arquivo: `src/core/pipeline/__tests__/anti-greeting.test.ts`
   - 8 casos dos conversas: Tania, Julllys, Paty, etc (ler de `baseline.log`)
   - Verificar: se lead pergunta sobre preço, intent final != "greeting"
   - Verificar: se lead só cumprimenta, intent final = "greeting" ✓
   
   ```typescript
   describe("Guard: Anti-saudação genérica", () => {
     it("F1: Lead pergunta preço → intent não é greeting", async () => {
       const result = await coerceBusinessIntent({
         message: "Olá! Posso ter mais informações sobre custo?",
         intent: "greeting", // Classificador pode errar
         treatments: [],
         isClinicSegment: true,
       });
       expect(result).not.toBe("greeting");
       expect([result]).toContain("price_inquiry" | "general_question");
     });
   });
   ```

4. **Replay validation** (~2h)
   ```bash
   npm run replay:conversas -- --clinic vitalli --cases-file /tmp/vitalli-20-cases.json \
     2>&1 | tee /tmp/after-p01.log
   
   # Esperado: ❌ F1 reduzida de 10 → ~2
   diff -u /tmp/baseline-08-07.log /tmp/after-p01.log
   ```

5. **Ximendes retroativo** (~1h)
   ```bash
   npm run replay:conversas -- --clinic ximendes \
     2>&1 | tee /tmp/ximendes-p01.log
   
   # Não deve regressar (score antes ≈ 58%)
   grep "Resultado:" /tmp/ximendes-p01.log
   ```

**Checklist**:
- [ ] Código compilar (`npm run build`)
- [ ] Testes passar (`npm run test -- anti-greeting`)
- [ ] F1 reduzida em replay vitalli
- [ ] Ximendes sem regressão
- [ ] Código revisado por revisor-multitenant
- [ ] PR criada

**Saída**: PR #xxx (feat/p01-anti-greeting) pronto para merge

---

#### Branch 2: `feat/p02-maintenance` (P0.2 — Manutenção no playbook) · DEPENDE P0.1

**Quem**: engenheiro-conversa (start T+1, paralelo com P0.1 50%)  
**Tempo estimado**: 6h  

**Tarefas**:

1. **Verificar playbook atual de Vitalli** (~1h)
   ```bash
   # Query: Qual é o playbook ativo da Vitalli?
   psql $DATABASE_URL -c "
   SELECT p.id, p.name, p.clinic_id 
   FROM playbook_versions p 
   JOIN organizations o ON p.clinic_id = o.id 
   WHERE o.slug = 'clinica-vitalli' 
   ORDER BY p.created_at DESC LIMIT 5;"
   ```
   
   Esperado: Encontrar versão "Promocional (vigente)" com ID xyz

2. **Adicionar tratamentos de manutenção** (~2h)
   - Arquivo: `src/infrastructure/db/schema.ts` (se novo campo necessário)
   - Ou: `scripts/seed-vitalli-playbook.ts` (novo arquivo)
   
   ```typescript
   // Adicionar ao playbook de Vitalli:
   const MAINTENANCE_TREATMENTS = [
     {
       clinicId: VITALLI_ID,
       name: "Manutenção de Lentes",
       description: "Limpeza, polimento e inspeção periódica de lentes de resina",
       basePrice: 40000, // R$ 400 em centavos
       aliases: ["manutenção", "manutencao", "limpeza", "manutenção de lentes"],
     },
     {
       clinicId: VITALLI_ID,
       name: "Reparo de Lente Externo",
       description: "Reparo de lente não feita pela Vitalli",
       basePrice: 25000, // R$ 250
       aliases: ["reparo", "reparo de lente", "lente quebrada"],
     },
     {
       clinicId: VITALLI_ID,
       name: "Remoção de Lente",
       description: "Remoção de lente de resina",
       basePrice: 40000, // R$ 400
       aliases: ["remoção", "remocao", "remover lente"],
     },
   ];
   ```

3. **Adicionar guardrail de detecção** (~2h)
   - Arquivo: `src/core/intelligence/TreatmentGuards.ts`
   - Adicionar guard existente para manutenção
   
   ```typescript
   export function detectMaintenanceInquiry(message: string): boolean {
     const keywords = ["manutenção", "manutencao", "limpeza", "reparo", "remoção"];
     return keywords.some(k => message.toLowerCase().includes(k));
   }
   
   // Em ConversationOrchestrator:
   if (detectMaintenanceInquiry(message)) {
     return "treatment_inquiry"; // Não "general_question"
   }
   ```

4. **Testes** (~1h)
   - Testar contra Conversa 14 (Vuulgo_wm): "...manutenção... e reparo..."
   - Esperado: IA responde preço R$400 + R$250, não "depende da avaliação"

5. **Replay validation** (~1h)
   ```bash
   npm run replay:conversas -- --clinic vitalli --cases-file /tmp/vitalli-20-cases.json \
     2>&1 | tee /tmp/after-p02.log
   
   # Esperado: ❌ F5 reduzida de 3 → 0
   ```

**Checklist**:
- [ ] Treatments criados no banco
- [ ] Guard detecta manutenção
- [ ] Testes passar
- [ ] F5 eliminada em replay
- [ ] PR revisada

**Saída**: PR #xxx (feat/p02-maintenance) pronto para merge

---

#### Branch 3: `feat/p03-channel-safety-ui` (P0.3 — UI de caps) · INDEPENDENTE

**Quem**: especialista-infra  
**Tempo estimado**: 6h  

**Tarefas**:

1. **Frontend: Componente de caps na UI owner** (~3h)
   - Arquivo: `src/app/(clinic)/app/settings/channel-safety.tsx` (novo ou extend)
   - Inputs:
     - `outbound_hourly_cap` (default 40) → Vitalli: 15
     - `outbound_daily_cap` (default 200) → Vitalli: 60
     - Quiet hours (9-20, São Paulo timezone)
     - `shouldSendAutomatedClinicOutbound` toggle (reply-only mode)
   
   ```tsx
   <ChannelSafetySettings
     clinicId={clinicId}
     defaults={{
       hourlyCapDefault: 40,
       dailyCapDefault: 200,
       quietHours: "09:00-20:00",
       timezone: clinic.timezone,
     }}
   />
   ```

2. **Backend: API endpoint** (~2h)
   - Arquivo: `src/app/api/clinics/[id]/channel-safety/route.ts`
   - PATCH endpoint: atualizar `organizations.outbound_hourly_cap`, etc
   - Validação: caps > 0, < 200
   - Log: registrar mudança com `updatedBy`

3. **Aplicar preset Vitalli** (~1h)
   ```bash
   # Via API (após deploy) ou direct SQL:
   UPDATE organizations 
   SET outbound_hourly_cap = 15, outbound_daily_cap = 60
   WHERE slug = 'clinica-vitalli';
   ```

**Checklist**:
- [ ] UI renderizar sem crash
- [ ] Valores persistir no banco
- [ ] Validação funcionar
- [ ] Vitalli preset aplicado
- [ ] Revisor-multitenant OK (segurança)

**Saída**: UI pronta, preset aplicado

---

### QUARTA-FEIRA 10/07 (T+2) — FINALIZAR P0.1/P0.2, VALIDAÇÃO CRUZADA

#### Morning (09:00-12:00) → Merge P0.1 + P0.2

**Tasks**:
1. Code review final (revisor-multitenant + tech lead)
2. Merge para develop (NOT main yet — validação antes)
3. Deploy para staging (Vercel preview)
4. Gleice testa preview (manualmente, 5 min)

#### Afternoon (14:00-17:00) → Validação cruzada

```bash
# Vitalli com P0.1 + P0.2
npm run replay:conversas -- --clinic vitalli --cases-file /tmp/vitalli-20-cases.json \
  > /tmp/after-p01-p02.log

# Esperado: F1 reduzida 10→2, F5 reduzida 3→0

# Ximendes sem regressão
npm run replay:conversas -- --clinic ximendes \
  > /tmp/ximendes-after-p01-p02.log

# Score deve ser ≈ 58% (sem piora)
```

**Saída**: Report de validação cruzada

---

### QUINTA-FEIRA 11/07 (T+3) — P0.5 + P0.6 (Minor fixes)

#### Morning (09:00-12:00) → P0.5 (Termos desconhecidos)

**Branch**: `feat/p05-unknown-terms`  
**Tempo**: 4h  
**Tarefas**:
1. Guard: Se termo não está em `treatments` e não está em `objections`, redirecionar
2. Resposta: "Que legal! Aqui na Vitalli nós trabalhamos com [lista]. Qual tem interesse?"
3. Testar contra Conversa 8 (Jose) e Conversa 12 (Emanuelle)

#### Afternoon (14:00-17:00) → P0.6 (Sentry + crash fallback)

**Branch**: `feat/p06-crash-fallback`  
**Tempo**: 4h  
**Tarefas**:
1. Adicionar timeout de 5s no composer
2. Se timeout, retry 1x com timeout 10s
3. Se falhar 2x, fallback: "Deixa eu tentar novamente..."
4. Log em Sentry com contexto completo
5. Monitorar em dashboard

**Checklist**:
- [ ] P0.5 testes passar
- [ ] P0.6 testes passar
- [ ] Ambas PRs revisadas
- [ ] Ready para merge

---

### SEXTA-FEIRA 12/07 (T+4) — MERGE + VALIDAÇÃO FINAL

#### Morning (09:00-12:00) → Merge todas PRs

**Sequence**:
1. P0.1 → develop
2. P0.2 → develop
3. P0.3 → develop
4. P0.5 → develop
5. P0.6 → develop

#### Afternoon (14:00-17:00) → Replay final + score

```bash
# Rodada final de validação
npm run replay:conversas -- --clinic vitalli --cases-file /tmp/vitalli-20-cases.json \
  > /tmp/final-vitalli.log

# Report
grep -E "^❌|^✓|Resultado:" /tmp/final-vitalli.log

# Expected score: 85%+
```

**Target**:
- F1: 10 → ≤2 (❌ 80% redução)
- F3: 2 → ≤1 (❌ 50% redução)
- F5: 3 → 0 (✓ ELIMINADO)
- F9: 1 → 0 (✓ ELIMINADO)
- **Score: ≥85%**

**Saída**: `/tmp/final-vitalli.log` + report

---

## 📋 SEMANA 2: E2E + GO-LIVE (T+5 até T+7)

### SEGUNDA-FEIRA 15/07 (T+7) — E2E COM GLEICE + FINAL CHECKS

#### Morning (09:00-12:00) → E2E com Gleice

**Setup**:
- Gleice usa número Vitalli real (ainda em shadow mode)
- Testa 5 conversas do top das 20
- **Não** simulation — **REAL** mensagens via WhatsApp

**Test cases**:
1. "Qual o valor de 10 lentes simplificadas?" → Deve responder preço (não menu)
2. "Meu amigo quer fazer manutenção nas lentes dele, quanto custa?" → Deve responder R$400
3. "Que legal seus resultados! Como faço pra agendar?" → Deve oferecer horários (não menu)
4. "Ouvi falar da Dental Luxe de vocês" → Deve perguntar o que quer (não saudação genérica)
5. "Estou aqui na frente da clínica" → Deve reconhecer (patient_arrived, não greeting)

**Validação**:
- [ ] Pergunta 1 → IA cota preço correto (1.500/1.800 promo, verificar playbook)
- [ ] Pergunta 2 → IA cota R$400 (manutenção)
- [ ] Pergunta 3 → IA oferece 5 slots, lead escolhe número
- [ ] Pergunta 4 → IA pergunta qual serviço interessa (não menu genérico)
- [ ] Pergunta 5 → IA reconhece chegada, notifica Gleice

**Gleice feedback**:
- Registro em Sentry com tag `e2e:vitalli:gleice`
- Qualidade de resposta: thumbs up/down
- Qualidade de agendamento: funcionou?
- Crashes: nenhum?

#### Afternoon (14:00-17:00) → Aplicar UIde caps + quiet hours

**Tasks**:
1. Acessar painel owner Vitalli
2. Aplicar preset: caps 15/60, quiet hours 9-20 São Paulo, reply-only 2 semanas
3. Validar que valores foram salvos no banco
4. Configurar notificação de safety alerts (Gleice recebe aviso se caps atingidos)

**Checklist**:
- [ ] E2E passou com Gleice
- [ ] Gleice feedback registrado em Sentry
- [ ] Caps aplicadas corretamente
- [ ] UI de caps funcionando
- [ ] Monitoring dashboard pronto

---

### TERÇA-FEIRA 16/07 (T+8) — PRÉ-GO-LIVE (SOFT LAUNCH)

#### Morning → Último check técnico

```bash
# Verificar:
npm run verify  # Tests + typecheck
npm run build   # Production build
npm run replay:conversas -- --clinic vitalli > /tmp/pre-launch.log
npm run replay:conversas -- --clinic ximendes > /tmp/ximendes-pre-launch.log

# Score check
grep "Resultado:" /tmp/pre-launch.log /tmp/ximendes-pre-launch.log
```

**Go/No-Go Decision**:
- [ ] Vitalli score ≥85%
- [ ] Ximendes score ≥58% (sem regressão)
- [ ] E2E com Gleice 5/5 OK
- [ ] Caps + quiet hours aplicadas
- [ ] Sentry monitoring active
- [ ] Rollback procedure documentado

**If all green → Proceed to go-live**

#### Afternoon → Preparação operacional

**Gleice prep** (30 min):
- Explicar que shadow mode vai desligar
- Mostrar inbox com novos leads reais
- Explicar quando intervir manualmente
- On-call procedure (número de emergência)

**Team standup** (30 min):
- Revisor-multitenant: Segurança OK?
- Especialista-infra: Infra OK? Neon OK?
- Guardião-operacional: Monitoramento OK?
- Estrategista-gtm: Próximos passos de venda?

---

### QUARTA-FEIRA 17/07 (T+9) — GO-LIVE 🚀

#### Pre-go-live (18:00 São Paulo time)

**Checklist final**:
- [ ] Última validação de código
- [ ] Sentry + Analytics dashboard abertos
- [ ] Gleice no WhatsApp, online
- [ ] Backup de shadow mode config (rollback rápido)
- [ ] Slack channel #vitalli-live para notificações

#### 21:00 → Desligar shadow mode

```bash
# Atualizar em banco:
UPDATE organizations 
SET channel_mode = 'live' 
WHERE slug = 'clinica-vitalli';

# Log em Sentry
Sentry.captureEvent({ 
  message: "Vitalli shadow mode disabled → LIVE",
  level: "info",
  tags: { vitalli: "go-live", timestamp: new Date() }
});
```

**Monitoramento contínuo** (21:00 - 22:00):
- Sentry: Errors per minute (target: 0)
- Analytics: Leads incoming (target: > 5/min durante horário)
- Gleice: % de conversas respondidas em <1min (target: >95%)
- Gleice: % de manual intervention (target: <10%)

#### 22:00+ → Vigilância reduzida

- Hourly checks (não minuto a minuto)
- Gleice on-call se needed
- Log alerts em #vitalli-live Slack

**Rollback trigger** (ativa volta pra shadow mode IMEDIATO):
- Sentry errors/min > 5 por 10 min consecutivos
- Leads sendo respondidas em >5min (sistema lento)
- Manual intervention > 30% (IA falhando)
- Crash na IA em >2 conversas diferentes

---

## 🎯 MÉTRICAS DE SUCESSO

### Durante os 7 dias de implementação

| Dia | P0.x | Vitalli Score | Ximendes Score | Blocker? |
|-----|------|---------------|----------------|----------|
| T | Baseline | 60% | 58% | None |
| T+1 | P0.1 in progress | 70% | 58% ✓ | P0.1 must be green |
| T+2 | P0.1 + P0.2 | 78% | 58% ✓ | Merge approval |
| T+3 | + P0.3 | 82% | 59% ✓ | None |
| T+4 | + P0.5 + P0.6 | 85%+ | 58% ✓ | Ready for E2E |
| T+5 | E2E + final | 87%+ | 58% ✓ | Gleice sign-off |
| T+6 | Pre-launch | 87%+ | 58% ✓ | Go/No-Go decision |
| T+7 | **GO-LIVE** | Monitor | Monitor | 24h safety check |

### First week post-launch

| Métrica | Target | How to measure |
|---------|--------|-----------------|
| **First response time** | <1min | Analytics dashboard |
| **Manual intervention %** | <10% (vs 30% before) | Gleice report |
| **Lead satisfaction** | NPS > 0 | Sentry feedback tag |
| **Crashes** | 0 | Sentry errors |
| **Uptime** | 99%+ | Neon + Vercel status |

---

## 👥 RESPONSÁVEIS + COMUNICAÇÃO

### Daily standup (10:00 São Paulo time)

**Quem**: Brendon, engenheiro-conversa, especialista-infra, revisor-multitenant, Gleice  
**Duração**: 15 min  
**Slides**: Print de `/tmp/*after*.log` + replay report  
**Decisão**: Go → próximo P0, ou BLOCKER → fix antes de mergear

### Weekly check-in (Friday 17:00)

**Quem**: Brendon + all  
**Topics**: 
- Cumprimento de deadlines
- Riscos ante go-live
- Gleice feedback
- Últimos detalhes

### Post-go-live oncall (T+7 até T+14)

**Gleice + tech on-call**: Slack #vitalli-live  
**Response time**: <5 min para crashes  
**Escalation**: Brendon if Gleice can't handle

---

## 📌 DECISÕES CRÍTICAS

### 1. Desligar shadow mode em T+7, se e somente se:
- Vitalli replay score ≥85%
- Ximendes replay score ≥58% (sem regressão)
- E2E com Gleice 5/5 OK
- Caps + quiet hours aplicadas

**If any condition fails**: +3 days de iteração (T+10 novo attempt)

### 2. Versionamento de playbook (R$1.500 vs R$1.700)
- Deixar como está (manual, conforme memory prospect-vitalli.md)
- Roadmap: ADR-007 (depois de go-live)

### 3. Agenda da Vitalli
- Não importar ainda (usamos slots estáticos)
- T+14 (próxima sprint) → integração com Google Calendar

### 4. Gleice manual intervention
- Esperado: reduzir de 30% (shadow) → 10% (live)
- Além disso: problema de escalabilidade (precisa de mais IA, não manual)
- Action: Monitorar; if >15% em 1 semana, backlog uma nova feature

---

## 📞 CONTATOS CRÍTICOS

- **Brendon** (dono): brendonwalefyom@gmail.com
- **Gleice** (operador Vitalli): [add WhatsApp ou email]
- **revisor-multitenant** (segurança): [agent assignment]
- **engenheiro-conversa** (IA): [assignment]
- **especialista-infra** (infra): [assignment]

---

## ✅ CHECKLIST PRÉ-GO-LIVE FINAL

- [ ] Baseline capturado em `./reports/vitalli-baseline.txt`
- [ ] P0.1 (anti-greeting) merge em develop
- [ ] P0.2 (maintenance) merge em develop
- [ ] P0.3 (UI caps) merge em develop
- [ ] P0.5 (unknown terms) merge em develop
- [ ] P0.6 (crash fallback) merge em develop
- [ ] Vitalli replay score ≥85%
- [ ] Ximendes replay score ≥58% (no regression)
- [ ] E2E com Gleice: 5/5 conversas OK
- [ ] Caps 15/60 + quiet hours 9-20 aplicadas
- [ ] Monitoring dashboard (Sentry + Analytics) pronto
- [ ] Slack #vitalli-live criado + on-call configured
- [ ] Rollback procedure documentado
- [ ] Team briefing complete
- [ ] Victor (dono Vitalli) notificado de go-live

---

## 🚨 CONTINGENCY

### If score stays 75% (not reaching 85%):

**Option A**: Ajustar target para 75% (documentar por quê)  
**Option B**: +3 days iteração (retry T+10)  
**Option C**: Go-live com shadow mode ligada (safer path, já planejado)

### If Ximendes regride:

**Immediate action**: Revert P0.x que causou regressão  
**Investigate**: Por que o fix que helpa Vitalli prejudica Ximendes?  
**Decision**: Customizar fix ou mudar estratégia?

### If Gleice reports >20% manual intervention in first week:

**Not a blocker** (esperado em semana 1)  
**Action**: Monitorar; se continuar em semana 2, backlog nova feature

---

## 📊 DASHBOARD DE PROGRESSO

Usar este template diariamente:

```
╔════════════════════════════════════════════════════════════════╗
║  Vitalli Go-Live Progress | 08/07 — 17/07/2026                ║
╚════════════════════════════════════════════════════════════════╝

BASELINE (T = 08/07)
  Score: 60% | F1: 10 | F3: 2 | F5: 3 | F9: 1
  Status: ✓ Captured

P0.1 — Anti-Greeting (Target T+1, Deadline T+2)
  Branch: feat/p01-anti-greeting
  Status: ⏳ In progress
  Score impact: 10 → 2 F1 (expected 70% total)
  Blocker: None

P0.2 — Maintenance (Target T+2, Deadline T+3)
  Branch: feat/p02-maintenance
  Status: ⏳ Queued
  Score impact: 3 → 0 F5 (expected 78% total)
  Blocker: P0.1 review

P0.3 — Channel Safety UI (Target T+1, Deadline T+3)
  Branch: feat/p03-channel-safety-ui
  Status: ⏳ In progress (paralelo)
  Score impact: None (operacional)
  Blocker: None

P0.5 — Unknown Terms (Target T+3, Deadline T+4)
  Branch: feat/p05-unknown-terms
  Status: 🔄 Ready
  Score impact: 2 → 1 F3 (expected 82% total)
  Blocker: None

P0.6 — Crash Fallback (Target T+3, Deadline T+4)
  Branch: feat/p06-crash-fallback
  Status: 🔄 Ready
  Score impact: 1 → 0 F9 (expected 85% total)
  Blocker: None

E2E WITH GLEICE (Target T+5, Deadline T+6)
  Status: ⏳ Scheduled
  Checklist: [ ] Price [ ] Maintenance [ ] Booking [ ] Terms [ ] Arrived
  Blocker: All P0.x green + score ≥85%

GO-LIVE (T+7, 21:00 São Paulo)
  Decision: 🟡 PENDING (metrics check)
  Rollback plan: Ready
  Monitoring: Active
  On-call: Gleice + tech

════════════════════════════════════════════════════════════════

NEXT STANDUP: 09/07 10:00 | Owner: Brendon
```

---

**Próximo passo**: Print este documento, compartilhar com time e tech lead, e iniciar Fase A (baseline) HOJE.

**Garantia**: Se seguir este plano, Vitalli vai estar em produção com 85%+ de acurácia em 7 dias, com zero surpresas.

---

**Assinado**: Brendon + Claude Code  
**Data**: 08/07/2026 20:30 São Paulo time  
**Versão**: 1.0 (Estratégia final de go-live)
