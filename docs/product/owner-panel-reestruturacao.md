# Reestruturação do painel do owner

> **Para execução, a fonte canônica é o ADR:**
> `docs/architecture/adr/adr-006-owner-panel-restructure.md`.
> Este doc guarda o racional de produto.

Decisão de 06/07/2026: a página da clínica no owner virou uma "salada" — o
dono do produto se perde nela. Este doc registra o diagnóstico e a
reestruturação aprovada, para execução (candidato natural: agente
`designer-ux`).

## Diagnóstico (medido no código)

- `owner/clinics/[clinicId]/page.tsx`: **1.424 linhas**, 8 seções empilhadas
  sem hierarquia — Clinic Blueprint, Temperatura, Handoffs ativos, Volume 14
  dias, Acesso da organização, Plano de assinatura, Automação, Segurança de
  canal — mais flash alerts, badges de status e 3 diálogos destrutivos
  (reset / arquivar / purge).
- **"Onboarding" existe em 4 lugares com 4 nomes**: `/owner/clinics/novo`
  (diagnóstico comercial), `/owner/clinics/new` (form completo, fallback
  técnico), `/owner/onboarding/[clinicId]` (wizard 7 passos),
  `/owner/clinics/[clinicId]/blueprint` (rota própria E seção duplicada na
  página da clínica). `/modules` é mais uma rota solta.
- Home do owner: 1.193 linhas.

Causa raiz: a página mistura **4 preocupações de momentos diferentes** da
vida da clínica num único scroll: implantação, operação diária, configuração
e ações destrutivas.

## Proposta

### Página da clínica → 3 abas + zona de perigo

Reorganizar por preocupação, seguindo o ciclo de vida (visão da timeline em
`ficha-setup-clinica.md` Parte 2):

| Aba | Conteúdo | Quando é o default |
|---|---|---|
| **Implantação** | Timeline de implantação (diagnóstico → conectado → shadow → estudo → validação → go-live). Absorve Onboarding (wizard), Blueprint e, futuramente, o setup study (ADR-002) como passos — deixam de ser destinos soltos | Enquanto não está em produção |
| **Operação** | Temperatura, Handoffs ativos, Volume 14 dias, alertas | Depois do go-live |
| **Configuração** | Automação, Segurança de canal, Módulos, Plano, Acesso | — |

- **Zona de perigo**: reset/arquivar/purge saem do corpo e viram bloco único
  no fim da aba Configuração, visualmente demarcado.
- **Header enxuto**: nome + status operacional + IA ativa/pausada + **um CTA
  contextual** (a próxima ação da timeline: "Conectar WhatsApp", "Gerar
  estudo", "Ativar go-live") + link Inbox. Módulos e Onboarding saem do
  header (viram conteúdo de aba).
- Aba default dinâmica pelo `operationalStatus`: clínica em implantação abre
  em Implantação; em produção abre em Operação.

### Vocabulário (matar a confusão de nomes)

- "Onboarding", "Blueprint" e "wizard" desaparecem da UI como conceitos
  distintos → tudo é **"Implantação"** (etapas da timeline).
- `/clinics/novo` é rebatizado na UI como **"Nova clínica"** (o diagnóstico
  comercial É o começo da implantação). `/clinics/new` permanece só como
  fallback técnico, sem link na navegação.

### Fases de execução

1. **Fase A — reorganizar sem mudar rota (barata, 1–2 dias)**: abas na página
   da clínica, zona de perigo, header enxuto. Rotas antigas continuam
   funcionando; a seção Blueprint duplicada na página some (fica só o link
   na aba Implantação).
2. **Fase B — timeline v1 (1–2 dias)**: os estados já existem no banco
   (`commercialDiagnostic`, `channelPairedAt`, `shadowModeEnabled`,
   `autoReplyEnabled`, `operationalStatus`) — a v1 é leitura + CTA por etapa,
   sem tabela nova. Setup study (ADR-002) pluga como etapa quando existir.
3. **Fase C — consolidação (depois)**: wizard e blueprint deixam de ser
   páginas independentes e são embutidos/linkados como passos da timeline;
   revisitar a home do owner (1.193 linhas) com o mesmo critério.

### Regras

- Design system atual do owner (tokens `--accent`, `--surface-raised`,
  `.panel`, dark forçado) — reestruturar layout, não redesenhar identidade.
- Nenhuma mudança de schema nas fases A e B.
- Fase A não muda nenhuma rota/action — é remontagem de JSX; riscos baixos,
  mas conferir mobile (`mobile-clinic-card*` na home).
