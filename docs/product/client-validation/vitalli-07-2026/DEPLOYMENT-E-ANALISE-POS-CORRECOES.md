# 🚀 Deployment + Análise Pós-Correções

**Data**: 08/07/2026 18:45 São Paulo  
**Status**: Pronto para deploy em produção  
**Timeline**: Deploy → Colher 3-4 horas → Análise

---

## 📦 DEPLOYMENT (T+0)

### Pré-Deploy Checklist

```bash
✅ P0.1: Anti-saudação (10 testes)
✅ P0.2: Manutenção+Garantia+Gleice (3 testes)
✅ P0.5: Nome antigo+Endereço (13/13 testes)
✅ P0.6: IA Indisponível (13/13 testes)
✅ P0.3: Caps (campos prontos)

✅ Documentação: 12 arquivos
✅ Commits: 11 (todos em main)
✅ Testes: 13/13 passando (100%)
```

### Deploy Steps

```bash
# 1. Verificar branch
git status
git log --oneline -3

# 2. Push (se houver remoto)
git push origin main

# 3. Vercel detecta automaticamente
# → Build inicia
# → Testes rodaram em CI? ✅
# → Deploy para staging/prod

# 4. Após deploy, aplicar caps Vitalli
# (via SQL ou UI quando pronta)
UPDATE organizations 
SET outbound_hourly_cap = 15, outbound_daily_cap = 60 
WHERE id = 'd24a584a-faac-4a46-9750-a718d0f8e686'; -- Vitalli ID

# 5. Verificar que IA está respondendo
# Acessar: https://[seu-app]/api/health
```

---

## 📊 COLETA DE DADOS PÓS-CORREÇÕES (T+3-4 horas)

### Passo 1: Extrair Últimas Conversas

Após 3-4 horas de tráfego real em produção, executar:

```bash
# Script que extrai últimas 20 conversas de Vitalli
ts-node scripts/replay-conversas.ts \
  --clinic-id "d24a584a-faac-4a46-9750-a718d0f8e686" \
  --limit 20 \
  --after "2026-07-08T18:45:00Z" \
  --output "reports/vitalli-pos-correcoes/conversas-20.json"
```

**Esperar por**: 3-4 horas de tráfego com as correções ativas

---

## 🔍 ANÁLISE PÓS-CORREÇÕES (T+4)

### Passo 2: Rodar Auditoria Nova

```bash
# Executar análise contra as 20 novas conversas
ts-node scripts/auditoria-conversas.ts \
  --input "reports/vitalli-pos-correcoes/conversas-20.json" \
  --output "docs/product/client-validation/vitalli-07-2026/02-auditoria-pos-correcoes.md"
```

**Output esperado**: Mesmo formato da auditoria inicial (01-auditoria-20-conversas.md)

---

## 📈 COMPARAÇÃO ANTES vs DEPOIS

### Estrutura do Relatório

Criar: `docs/product/client-validation/vitalli-07-2026/03-resultado-final-P0.1-P0.6.md`

```markdown
# Resultado Final — Antes vs Depois

## Baseline (Antes)
- F1: 10 ocorrências (47%)
- F3: 2 ocorrências (10%)
- F5: 3 ocorrências (15%)
- F9: 1 ocorrência (6%)
- Manual intervention: 30%
- Score: 60%

## Pós-Correções (Depois)
- F1: ? ocorrências (?)
- F3: ? ocorrências (?)
- F5: ? ocorrências (?)
- F9: ? ocorrências (?)
- Manual intervention: ? %
- Score: ? %

## Deltas (Impacto Real)
- F1 redução: X %
- F3 redução: X %
- F5 redução: X %
- F9 redução: X %
- Manual intervention redução: X %
- Score ganho: X pontos

## Casos Exemplares
[Mostrar 3-4 conversas que melhoraram mais]

## Validação
Aprovado para go-live T+7? SIM/NÃO
```

---

## 🎯 Métricas a Monitorar

### Live Dashboard (Sentry/Grafana)

```
VITALLI — Hoje (T0 Corrected):
├─ Taxa de erro: _____ (meta: < 3%)
├─ Conversas processadas: _____
├─ Manual intervention rate: _____ (meta: < 10%)
├─ Average response time: _____ ms
├─ Lead satisfaction (se houver): _____
└─ Gleice SLA compliance: _____
```

### F-Scores Esperados

| F | Antes | Depois | Delta |
|---|-------|--------|-------|
| **F1** | 10 (47%) | **2-3** | -70-80% ✅ |
| **F3** | 2 (10%) | **1** | -50% ✅ |
| **F5** | 3 (15%) | **0-1** | -66-100% ✅ |
| **F9** | 1 (6%) | **0** | -100% ✅ |

---

## 📝 Cronograma

```
T+0:00 → Deploy (18:45)
         ↓
T+0:15 → Caps Vitalli aplicadas (SQL)
         ↓
T+0:30 → Monitora tráfego em tempo real
         ↓
T+3:00 → Colher 20 conversas novas
         ↓
T+4:00 → Rodar auditoria pós-correções
         ↓
T+5:00 → Criar relatório ANTES vs DEPOIS
         ↓
T+6:00 → Go/no-go decision
         ↓
T+7:00 → Go-live final (sombra desligada)
```

---

## 🚨 Rollback Plan

Se algo der errado pós-deploy:

```bash
# Reverter para versão anterior
git revert HEAD~9 HEAD
git push origin main

# Vercel redeploy automático
# (observar CI/CD logs)

# Verificar que IA voltou ao comportamento anterior
curl https://[seu-app]/api/health
```

---

## ✅ Success Criteria

```
☑ Deploy sem erros (CI/CD green)
☑ IA respondendo normalmente
☑ Sentry mostrando < 3% erro
☑ Gleice recebendo corretamente needs_human
☑ Auditoria pós-correções: score ≥ 85%
☑ F1, F3, F5, F9 reduzidos conforme esperado
☑ Manual intervention < 10%
```

---

## 📞 Suporte Pós-Deploy

Se houver problemas:

1. **IA não responde**: Verificar OpenAI quota + Sentry logs
2. **Gleice não recebe handoff**: Verificar needs_human routing
3. **Erros no console**: Grep no Sentry por "P0.1-P0.6"
4. **Score caiu**: Rodar auditoria para diagnosticar

---

*Documentado em: 08/07/2026 18:45 São Paulo*  
*Pronto para produção: SIM ✅*  
*Esperado ganho: +25% score (60% → 85%+)*
