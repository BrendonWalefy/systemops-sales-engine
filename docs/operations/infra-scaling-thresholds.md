# Infra Scaling — Limites, Custos e Quando Trocar

**Última revisão:** 2026-06-30  
**Baseline:** dados reais do piloto Ximendes (junho 2026)

---

## Baseline: consumo real da Ximendes

| Métrica | Valor mensal (extrapolado de 12 dias) |
|---------|--------------------------------------|
| Mensagens WhatsApp | ~1.560/mês |
| Leads | ~90/mês |
| Agendamentos | ~30/mês |
| Neon compute | ~86 CU-hrs/mês |
| OpenAI | ~$1/mês |
| Z-API | R$79,99/instância |

Referência: 1x = Ximendes. Uma clínica "10x" projeta ~15.600 mensagens/mês.

---

## Peça 1 — Neon PostgreSQL

### Plano atual: Free (100 CU-hrs, 0,5 GB)

| Cenário | CU-hrs estimados | Custo Neon Launch ($0,106/CU-hr) |
|---------|-----------------|----------------------------------|
| 1 clínica pequena (1x) | ~86 | $0 (free) |
| 1 clínica grande (10x) | ~860 | ~$91/mês |
| 2 clínicas médias (2x cada) | ~344 | ~$36/mês |
| 5 clínicas pequenas | ~430 | ~$46/mês |

### Alternativas avaliadas

| Opção | Custo | Branching p/ CI | Esforço de migração |
|-------|-------|-----------------|---------------------|
| **Neon Launch** (recomendado) | ~$91/mês p/ 10x | ✅ nativo | zero |
| Supabase Pro | $25/mês flat | ⚠️ beta | ~1 dia |
| Render PostgreSQL | $20/mês (1 GB RAM) | ❌ | ~1 dia |
| Railway PostgreSQL | ~$15/mês | ❌ | ~1 dia |

### Recomendação por etapa

| Gatilho | Ação |
|---------|------|
| Até 2 clínicas pequenas (~170 CU-hrs) | Permanecer no Free |
| 1 clínica grande OU 3+ clínicas pequenas | **Ativar Neon Launch** (~$46–$91/mês) |
| Custo Neon > $75/mês por 2 meses seguidos | Avaliar migração para **Supabase Pro** ($25 flat) — só quando o branching do Supabase estiver GA e estável |

**Por que manter Neon agora:** o branching nativo é a fundação do `migration-ci.yml`. Migrar para Supabase quebra o CI que protege as migrations de produção. O Supabase branching ainda é beta (2026-06). Reavaliar no Q4 2026.

---

## Peça 2 — Z-API (WhatsApp)

### Plano atual: R$79,99/instância/mês (1 número por instância)

| Clínicas | Custo Z-API |
|----------|-------------|
| 1 | R$80/mês |
| 2 | R$160/mês |
| 3 | R$240/mês |
| 5 | R$400/mês |
| 10 | R$800/mês |

### Alternativa: Evolution API (self-hosted)

Evolution API é open source e compatível com a nossa stack (mesmos webhooks, mesma estrutura de payload). Um VPS Hetzner CX22 (2 vCPU, 4 GB RAM) roda instâncias ilimitadas.

| Clínicas | Z-API | Evolution API + Hetzner CX22 (~R$27/mês) | Economia acumulada |
|----------|-------|------------------------------------------|--------------------|
| 1 | R$80 | R$27 | -R$53 (não compensa) |
| 2 | R$160 | R$27 | +R$133/mês |
| 5 | R$400 | R$27 | +R$373/mês |
| 10 | R$800 | R$27 | +R$773/mês |

**Esforço de migração:** ~1–2 dias de desenvolvimento  
- Trocar URL base do webhook por clínica (campo no banco)  
- Adaptar autenticação (Evolution usa token por instância, igual ao Z-API)  
- Testar envio e recebimento em staging antes de migrar prod  
- **Perda:** suporte ao cliente que o Z-API oferece (você passa a operar a infra)

### Recomendação por etapa

| Gatilho | Ação |
|---------|------|
| 1 clínica | Manter Z-API — custo não justifica operar VPS |
| **A partir da 2ª clínica** | **Migrar para Evolution API no Hetzner** — break-even imediato, economiza R$130+/mês por clínica adicional |
| 5+ clínicas | Hetzner CX32 (4 vCPU, 8 GB) ~R$55/mês para maior estabilidade |

---

## Peça 3 — Vercel

### Plano atual: Pro ($20/mês) ✅

Vercel Pro aguenta escala muito além do volume projetado para 10+ clínicas. Serverless escala automaticamente com picos de mensagens. Sem gatilho de troca no horizonte visível.

**Alternativa futura (10+ clínicas com alta concorrência):** Railway ou Fly.io — reavaliar se o custo Vercel superar $100/mês, o que exigiria tráfego de dezenas de clínicas simultâneas.

---

## Peça 4 — OpenAI

Escala linear sem surpresas. Nenhum limite a atingir nos planos atuais.

| Clínicas | Custo estimado |
|----------|---------------|
| 1x Ximendes | ~R$5/mês |
| 1 clínica 10x | ~R$50/mês |
| 10 clínicas médias | ~R$50/mês |

Sem gatilho de troca. Monitorar via `/owner/financeiro`.

---

## Margens por plano com clínica 10x Ximendes

Custo adicional por uma clínica 10x: ~R$580/mês  
(Neon Launch $91 + Vercel Pro $20 já pago ÷ clínicas + Z-API R$80 + OpenAI R$50)

| Plano da clínica | MRR | Custo infra | Margem bruta |
|-----------------|-----|-------------|--------------|
| Starter (R$897) | R$897 | ~R$580 | ~35% — **inviável** |
| Growth (R$1.497) | R$1.497 | ~R$580 | ~61% — aceitável |
| Scale (R$2.997) | R$2.997 | ~R$580 | ~81% — excelente |

**Regra de bolso:** clínica com volume acima de 3x Ximendes não entra no Starter.

---

## Roadmap de decisões por marco

```
Hoje (1 clínica, Ximendes)
  → Neon Free + Z-API + Vercel Pro
  → Custo: ~R$82/mês | MRR: R$897 | Margem: ~91%

2ª clínica (qualquer tamanho)
  → Migrar Z-API → Evolution API no Hetzner (~R$27/mês)
  → Custo: ~R$200/mês | MRR: ~R$1.794 | Margem: ~89%

1 clínica grande (5–10x) OU 3+ clínicas pequenas
  → Ativar Neon Launch
  → Reavaliar plano da clínica: Growth mínimo para 10x

Custo Neon > $75/mês por 2 meses
  → Avaliar Supabase Pro ($25 flat) — depende de maturidade do branching

5+ clínicas simultâneas
  → Hetzner CX32 para Evolution API
  → Avaliar banco dedicado por tenant se storage > 4 GB
```

---

## Referências

- `docs/operations/backlog-staging-ci-migrations.md` — CI que depende do Neon branching
- `docs/product/cost-control.md` — histórico de custos reais
- `/owner/financeiro` — painel de custos em produção
