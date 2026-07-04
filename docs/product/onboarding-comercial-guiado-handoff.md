# Handoff — Onboarding Comercial Guiado

> Documento de continuação. Um agente pode retomar daqui sem re-investigar.
> Branch: `feat/onboarding-comercial-guiado` (criada a partir de `main` limpa).

## Contexto e decisão

O owner tem uma reunião com cliente **hoje** e o onboarding atual está ruim. A
tarefa é transformar a criação de organização numa **experiência de onboarding
comercial guiado**: diagnóstico → ROI → recomendação → proposta → criação.

**Decisão tomada (não reabrir):**

- Fazer a tela `/owner/clinics/novo` ("Diagnóstico rápido") **evoluir** para o
  onboarding comercial guiado. NÃO criar uma quarta tela.
- `/owner/clinics/new` (completa) permanece como fallback técnico. O wizard de 7
  passos (`/owner/onboarding/[clinicId]`) permanece como setup pós-criação.

**Princípios (inegociáveis):**

1. **ROI e recomendação são determinísticos** — matemática pura, sem LLM ao vivo.
   Já implementado no motor. Isso respeita a regra "o sistema decide, a LLM
   verbaliza" e evita latência/falha na frente do cliente.
2. **Faixa, nunca número único** no ROI (ex.: "R$ 3,2k–6,1k/mês") — honestidade.
3. **Responsivo**: mobile = captura rápida empilhada; desktop = duas colunas com
   resumo sticky em tempo real (igual ao mockup do usuário).
4. **Premium e coeso** com o design system: tokens `--accent`(#10b981),
   `--surface-raised`, `--muted`, `--line`; dark forçado via classe
   `owner-dark-forced` (como o painel owner).
5. **Captura dados** e persiste em `organizations.commercialDiagnostic` (jsonb).

## Referências de código (já lidas)

- Motor NOVO: `src/application/onboarding/commercial-diagnostic.ts` ✅ FEITO
- Action de criação: `src/app/(owner)/owner/clinics/novo/actions.ts`
  (`createProspectClinic` — cria org + playbookVersion + clinicMember, redireciona
  para `/owner/clinics/${id}/blueprint`).
- Tela atual (a substituir): `src/app/(owner)/owner/clinics/novo/page.tsx`
- Segmentos: `src/application/onboarding/segment-options.ts`
  (`SEGMENT_OPTIONS`, `resolveSegmentDefaults`, `SegmentKey`).
- Layout owner (sidebar já envolve a tela): `src/app/(owner)/layout.tsx`
- Tokens: `src/app/globals.css` (`:root` linhas ~3-23; classes `.panel`,
  `.primary-button`, `.eyebrow`, `.metric`).
- Schema: `src/infrastructure/db/schema.ts` — tabela `organizations` na linha 175.
  Já usa jsonb (`menuItems`, `installmentRates`) → padrão a seguir.
- Migrações: `drizzle/` (última = `0051_...`). `db:check` = `Drizzle meta OK`.
  Gerar com `npm run db:generate` (não precisa de DB, lê só o schema).

## Status das etapas

- [x] **1. Motor determinístico** — `commercial-diagnostic.ts` pronto.
      Exporta: `computeCommercialDiagnostic(input)`, `formatBrl`, buckets
      (`LEADS_BUCKETS`, `APPOINTMENTS_BUCKETS`, `TICKET_BUCKETS`, `TEAM_BUCKETS`),
      opções (`RESPONSE_TIME_OPTIONS`, `CHANNEL_OPTIONS`, `SCHEDULE_OPTIONS`,
      `PAIN_OPTIONS`) e tipos (`CommercialDiagnosticInput`,
      `CommercialDiagnosticResult`). ROI = recuperar 5–22% dos leads não
      convertidos (faixa por dores + tempo de resposta).
- [ ] **2. Teste unitário** do motor.
- [ ] **3. Coluna `commercialDiagnostic` jsonb** em `organizations` + migração.
- [ ] **4. Estender `createProspectClinic`** para persistir diagnóstico + city/greeting.
- [ ] **5. Reconstruir `novo/page.tsx`** como onboarding guiado premium responsivo.
- [ ] **6. Verify**: `npm run verify` (db:check + lint + typecheck + test) + `next build`.

---

## Etapa 2 — Teste do motor

Criar `src/__tests__/CommercialDiagnostic.test.ts`. O projeto usa o test runner
padrão (ver outros testes em `src/__tests__/`, ex.: `OnboardingTreatmentSync.test.ts`
— checar se é `vitest` ou `node:test`). Casos:

- Sem dados (`leadsBucket`/`ticketBucket` null) → `hasEnoughData === false`,
  `additionalRevenueBrl.low === 0`.
- `leads=300, appointments=100, ticket=800, pains=[after_hours, slow_reply],
  responseTime=over_6h` → `missedLeads === 200`, `additionalRevenueBrl.high >
  additionalRevenueBrl.low > 0`, `recoveredAppointments.high <= missedLeads`.
- Recaptura respeita teto: `recHigh <= 0.22` (verificar via
  `recoveredAppointments.high / missedLeads <= 0.22`).
- Plano: `leads<=150 → essencial`; `<=500 → avancado`; `>500 → rede`.
- `roiMultiple`, `netGainBrl`, `fitScore` (0..98), `closeProbability` (0..95) coerentes.

## Etapa 3 — Coluna + migração

Em `schema.ts`, tabela `organizations` (junto dos outros jsonb), adicionar:

```ts
// Diagnóstico comercial capturado no onboarding guiado (dados p/ decisão futura).
commercialDiagnostic: jsonb("commercial_diagnostic").$type<CommercialDiagnosticSnapshot>(),
```

Definir `CommercialDiagnosticSnapshot` = o `CommercialDiagnosticInput` +
subconjunto do resultado (leadsPerMonth, additionalRevenueBrl, plan.key,
fitScore, closeProbability, capturedAt ISO string). Pode importar tipos do motor
ou declarar um tipo local no schema (schema evita imports pesados; declarar tipo
`type` inline é ok). Depois:

```bash
npm run db:generate   # gera drizzle/0052_*.sql + atualiza meta
npm run db:check      # deve voltar "Drizzle meta OK"
```

Migração é aditiva (coluna nullable) → segura. Vercel prod roda migração sozinho.

## Etapa 4 — Action

Em `createProspectClinic` (`novo/actions.ts`):

- Ler novos campos do FormData: `city` (já lê), `greetingMessage`, e um campo
  `diagnostic` (JSON string do `CommercialDiagnosticInput` + snapshot computado).
- `JSON.parse` com try/catch → se inválido, seguir sem diagnóstico (não quebrar).
- Gravar `commercialDiagnostic` no insert de `organizations`. Gravar
  `greetingMessage` se vier. `plan` deve vir do plano recomendado/escolhido.
- Manter redirect para `/owner/clinics/${clinicId}/blueprint`.

## Etapa 5 — Tela (o grosso do trabalho)

Reescrever `novo/page.tsx` (client component). Sugerido: extrair o corpo para
`novo/guided-onboarding-client.tsx` e manter `page.tsx` fino. Estrutura:

**Layout desktop (>= 960px):** grid 2 colunas — principal (fluxo) + aside sticky
(resumo em tempo real). **Mobile:** 1 coluna; resumo vira um bloco sticky compacto
no rodapé (receita adicional + plano + CTA) e o resumo completo aparece abaixo.
Use um `<style>` scoped no componente (prefixo `onb-`) com media queries — NÃO dá
pra fazer responsivo só com inline style.

**Stepper (3 passos, enxuto):**

1. **Diagnóstico** (a tela principal, igual ao mockup):
   - Chips de segmento (usar `SEGMENT_OPTIONS`).
   - Botões-bucket: Leads/mês (`LEADS_BUCKETS`), Agendamentos/mês
     (`APPOINTMENTS_BUCKETS`), Equipe (`TEAM_BUCKETS`), Ticket (`TICKET_BUCKETS`).
   - Canal (`CHANNEL_OPTIONS`), Agenda (`SCHEDULE_OPTIONS`), Tempo de resposta
     (`RESPONSE_TIME_OPTIONS`).
   - Dores multi-select (`PAIN_OPTIONS`), máx 2 destacadas.
   - Essenciais: Nome do estabelecimento, Cidade, Saudação (prefill via
     `resolveSegmentDefaults(segment)`).
   - Card "Sugestão da IA" = `result.insight` (é template, não LLM).
   - Card "Configuração recomendada" = `result.config` (playbook, canal, agenda,
     automação, prioridade).
2. **Plano & Proposta:**
   - Cards de plano (Essencial/Growth/Rede) com o recomendado destacado
     (`result.plan.key`), permitir override.
   - ROI: receita atual, receita adicional (faixa), custo, ganho líquido, ROI x.
   - Botão **"Copiar proposta para WhatsApp"** → monta texto a partir de
     `result` (diagnóstico + solução + plano + ROI + próximos passos). Usar
     `navigator.clipboard.writeText`. (SEM PDF nesta fase.)
3. **Criar acesso:** email + senha do admin → `form action={createProspectClinic}`.
   Hidden inputs: name, segment, specialty, city, greetingMessage, plan,
   `diagnostic` (JSON.stringify do input+snapshot).

**Aside "Resumo em tempo real" (sticky, sempre visível desktop):** replica o
mockup — Segmento, Estágio atual, Plano sugerido, Receita estimada (faixa),
Custo IA+WA/Custo plano, Tempo de implantação, barra "Probabilidade de
fechamento" (`result.closeProbability`). Blocos: "Impacto previsto" (leads,
tempo poupado, conversão potencial, margem prevista), "Fit do cliente"
(donut/anel com `result.fitScore` + `result.fitLabel` + checklist de fit),
"Pendências para fechar" (`result.checklist` comercial vs técnico),
"Próxima melhor ação" (`result.nextBestAction`).

**Autosave:** persistir o input em `localStorage` (chave `onb-draft`) com debounce;
mostrar "Rascunho salvo há X". Restaurar no mount. Limpar após criação.

**Topbar:** "Onboarding comercial guiado" + toggle "Modo guiado / Modo avançado"
(o "avançado" pode só linkar para `/owner/clinics/new`), botões "Salvar rascunho"
e "Continuar". Envolver tudo em `<div className="owner-dark-forced">`.

**Estilo premium:** cantos 12-14px, `--surface-raised` nos cards, `--line` nas
bordas, verde `--accent` só em seleção/CTA/positivo, tipografia com `.eyebrow`
(uppercase 11px) para rótulos. Ícones `lucide-react`. Evitar poluição: respiro
generoso, hierarquia clara.

## Etapa 6 — Verify

```bash
npm run verify        # db:check + lint + typecheck + test
npx next build        # ou npm run build — garantir que compila
```

Rodar o app (`/run` ou `npm run dev`) e abrir `/owner/clinics/novo` logada como
owner para conferir visual mobile + desktop. Corrigir o que quebrar.

## Observações / riscos

- NÃO commitar/pushar sem o usuário pedir. Se pedir, PR vai para `main` (base main).
- `db:check` faz parte do `verify` — se a coluna for adicionada sem `db:generate`,
  o meta fica dessincronizado e o verify falha. Sempre gerar a migração.
- Não introduzir chamada de LLM na tela — a narrativa é template do motor.
- Manter compatibilidade: `createProspectClinic` não pode quebrar o fluxo atual
  (todos os campos novos são opcionais).
