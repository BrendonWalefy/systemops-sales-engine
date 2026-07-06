# ADR-006: Reestruturação do painel do owner (página da clínica)

**Status:** Aprovado — implementação pendente
**Data:** 2026-07-06
**Contexto:** A página da clínica no owner acumula 8 seções sem hierarquia e "onboarding" existe em 4 rotas com 4 nomes — o próprio dono do produto se perde

---

## Contexto (medido no código em 06/07/2026)

- `src/app/(owner)/owner/clinics/[clinicId]/page.tsx`: **1.424 linhas**.
  Seções empilhadas, nesta ordem: Clinic Blueprint, Temperatura, Handoffs
  ativos, Volume — últimos 14 dias, Acesso da organização, Plano de
  assinatura, Automação, Segurança de canal. Mais: flash alerts, badges
  (Teste, status operacional, IA ativa/pausada), links de header
  (Módulos, Onboarding, Inbox) e 3 diálogos destrutivos
  (`archive-clinic-dialog.tsx`, `reset-clinic-dialog.tsx`,
  `purge-clinic-dialog.tsx`).
- Vocabulário fragmentado: `/owner/clinics/novo` (diagnóstico comercial),
  `/owner/clinics/new` (form completo, fallback), `/owner/onboarding/[id]`
  (wizard 7 passos), `/owner/clinics/[id]/blueprint` (rota própria E seção
  duplicada dentro da página), `/owner/clinics/[id]/modules`.
- Home `owner/page.tsx`: 1.193 linhas (mesmo problema, fora do escopo das
  fases A/B).

Causa raiz: a página mistura 4 preocupações de momentos diferentes da vida da
clínica — implantação, operação diária, configuração e ações destrutivas.

Racional de produto e visão da timeline em
`docs/product/owner-panel-reestruturacao.md` e
`docs/product/ficha-setup-clinica.md` (Parte 2).

## Decisão

### Página da clínica → 3 abas + zona de perigo

| Aba | Recebe (seções existentes) | Default quando |
|---|---|---|
| **Implantação** | Timeline de implantação (Fase B) + link para wizard e blueprint; a seção "Clinic Blueprint" duplicada na página **some** | `operationalStatus` ≠ produção |
| **Operação** | Temperatura, Handoffs ativos, Volume 14 dias, flash alerts | produção |
| **Configuração** | Automação, Segurança de canal, Módulos (embutir ou linkar), Plano de assinatura, Acesso da organização + **Zona de perigo** no fim (reset/arquivar/purge agrupados e demarcados) | — |

**Header enxuto**: nome + badges de status + **um CTA contextual** (a próxima
ação da timeline: "Conectar WhatsApp" / "Gerar estudo" / "Ativar go-live") +
Inbox. Links "Módulos" e "Onboarding" saem do header.

### Vocabulário

- Na UI, "Onboarding", "Blueprint" e "wizard" viram etapas de **"Implantação"**.
- `/clinics/novo` exibido como "Nova clínica". `/clinics/new` fica sem link
  na navegação (fallback técnico).
- Nenhuma rota é removida ou renomeada nas fases A/B — só a apresentação.

### Fases

**Fase A — abas sem mudar rota (1–2 dias).** Remontagem de JSX da página da
clínica: abas + zona de perigo + header enxuto. Nenhuma server action, rota
ou schema muda.

**Fase B — timeline v1 (1–2 dias).** Componente de timeline na aba
Implantação, **leitura pura** de estados que já existem:
`organizations.commercialDiagnostic` (diagnóstico feito), `channelPairedAt`
(canal conectado), `shadowModeEnabled` (coletando em shadow),
`setup_studies.status` (quando ADR-002 existir — etapa aparece condicionada à
tabela existir), `autoReplyEnabled` + `operationalStatus` (go-live). Cada
etapa: estado (feita/atual/futura) + CTA da etapa atual. Contador de
conversas do shadow: `COUNT` de conversas com mensagem no período
`channelPairedAt → now` (query barata, já indexada).

**Fase C — consolidação (posterior, fora deste ADR):** embutir
wizard/blueprint como passos da timeline; aplicar o mesmo critério à home.

## Apêndice de execução — decisões fechadas

1. **Mecânica das abas**: componente client com estado na URL
   (`?tab=implantacao|operacao|config`) via `useSearchParams` — deep-link
   funciona, zero mudança de rota. Server component da página continua
   buscando tudo; as abas só condicionam a renderização (o custo de dados já
   é pago hoje; otimizar fetch por aba NÃO é escopo).
2. **Aba default**: calculada no server pelo `operationalStatus` (helper
   `getClinicOperationalStatusLabel` já existe na página) quando `?tab` está
   ausente.
3. **Zona de perigo**: mover os 3 diálogos existentes sem alterá-los; bloco
   com borda/título "Zona de perigo" no fim da aba Configuração.
4. **Design system**: tokens e classes atuais do owner (`--accent`,
   `--surface-raised`, `.panel`, `.eyebrow`, dark forçado
   `owner-dark-forced`). Reestruturar layout, **não** redesenhar identidade.
   Conferir mobile (classes `mobile-clinic-card*` na home indicam padrão
   responsivo próprio).
5. **CTA contextual do header**: na Fase A, regra simples em código
   (sem timeline ainda): sem `channelPairedAt` → "Conectar WhatsApp" (link
   pro wizard); com pareamento e `shadowModeEnabled` → "Ver implantação"
   (abre aba); em produção → "Inbox". A Fase B substitui pela etapa da
   timeline.
6. **Testes**: a página é server component pesado — cobrir com teste dos
   helpers puros novos (cálculo de aba default, cálculo do CTA, estados da
   timeline na Fase B). Sem snapshot de página inteira.
7. **Executor sugerido**: agente `designer-ux` (Fase A) — é o caso de uso
   dele; Fase B pode ser o mesmo agente ou sessão geral.

## Regras do repo

- PR baseado na `main`; `npm run verify`; `revisor-multitenant` antes do push
  (diff toca página com server actions — mesmo sem mudá-las).
- Nenhuma migração nas fases A/B.

## Esforço estimado

| Fase | Esforço |
|---|---|
| A — abas + zona de perigo + header | 1–2 dias |
| B — timeline v1 | 1–2 dias |
