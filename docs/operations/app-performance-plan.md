# App Performance Plan

Objetivo: fazer o app parecer instantaneo nas rotas operacionais sem violar a arquitetura central do produto.

## Metas

- Feedback visual ao clique em ate `100ms`.
- Troca percebida de tela em ate `250ms` na navegacao cliente.
- Carga fria das telas principais abaixo de `1.5s` no p50 e abaixo de `3s` no p95.
- Zero telas em branco ou travadas durante transicoes.

## Estrategia

### 1. Fluidez percebida

- Manter o app shell persistente.
- Garantir `loading.tsx` ou skeleton coerente nas telas operacionais.
- Priorizar transicoes curtas e sem relayout brusco.
- Evitar que fetches bloqueiem o primeiro paint da area principal.

### 2. Fluidez real

- Prefetch agressivo das rotas mais provaveis.
- Cache curto no servidor para telas de configuracao e leitura frequente.
- Cache em memoria no cliente para dados da agenda e outras rotas com ida e volta constante.
- Eliminar queries redundantes e payloads excessivos.
- Reducao de payload: cada tela busca apenas as colunas que usa.

### 3. Seguranca operacional

- Cache curto apenas onde dado levemente stale e aceitavel.
- Invalidador explicito com `revalidateTag` nas mutacoes.
- Sem cache cego em fluxos criticos de booking ou inbox de conversa aberta.

## Estado por area

| Rota | loading.tsx | Prefetch | Cache servidor | Cache cliente |
|------|-------------|----------|----------------|---------------|
| /app/dashboard | ✅ | ✅ | ❌ | ❌ |
| /app/inbox | ✅ | ✅ | ❌ | ❌ |
| /app/agenda | ✅ | ✅ | ✅ profissionais + tratamentos | ✅ eventos |
| /app/settings/equipe | ✅ | ✅ | ✅ 30s | ❌ |
| /app/settings/profissionais | ✅ | ✅ | ✅ 30s | ❌ |
| /app/settings/pipeline | ✅ | ✅ | ✅ 30s | ❌ |

## Fases

## Fase 1 — Fundamentos (concluida)

- ✅ `loading.tsx` com skeleton estrutural em todas as rotas criticas.
- ✅ Prefetch via `router.prefetch()` no mount do `SidebarNav` + prop `prefetch` em todos os `Link` de navegacao.
- ✅ `unstable_cache` com TTL 30s e `revalidateTag` por clinica para settings (profissionais, equipe, pipeline).
- ✅ Invalidacao por tag em todas as mutacoes: server actions de equipe/pipeline e API routes de profissionais.
- ✅ Cache cliente (`client-json-cache.ts`) para eventos de agenda com invalidacao apos mutacoes.
- ✅ `Promise.all` em todas as paginas com multiplas queries independentes.

## Fase 1.5 — Reducao de payload (concluida)

- ✅ Agenda: `getCachedProfessionals` e `getCachedTreatmentsForAgenda` substituem repositorios diretos; profissionais e tratamentos sao cacheados entre navegacoes.
- ✅ Inbox: `selectDistinctOn(conversationId)` substituiu `select + orderBy global` que retornava potencialmente milhares de linhas para extrair apenas uma por conversa.

## Fase 2 — Instrumentacao e granularidade (proxima)

- Dashboard: quebrar em blocos com `Suspense` para streaming de cada secao (KPIs, grafico de fluxo, leads recentes, temperatura) — evita que a secao mais lenta bloqueie toda a tela.
- Cache curto para dados do dashboard (`unstable_cache` com TTL 60s para metricas historicas que toleram stale).
- Adicionar metrica de tempo de navegacao por rota via `performance.mark` no cliente para detectar regressoes antes de ir a producao.
- Definir budget de performance por tela baseado em medicoes reais.

## Fase 3 — Refinamentos avancados

- Optimistic UI nas mutacoes mais frequentes: toggle IA ativo/inativo, pausar conversa no inbox.
- Virtualizacao da lista de conversas no inbox quando ultrapassar ~50 itens.
- Warmup em background: ao abrir o inbox, pre-carregar os dados das 5 conversas mais recentes para que a transicao para a tela de conversa seja imediata.

## Areas Prioritarias

1. `app/dashboard`
2. `app/inbox`
3. `app/agenda`
4. `app/settings/equipe`
5. `app/settings/profissionais`
6. `app/settings/pipeline`
