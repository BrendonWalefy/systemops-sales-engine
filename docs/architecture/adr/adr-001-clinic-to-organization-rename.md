# ADR-001: Renomear domínio `Clinic` → `Organization`

**Status:** Aprovado — implementação pendente  
**Data:** 2026-06-30  
**Contexto:** Evolução do systemops-sales-engine como módulo de atendimento da systemops-platform

---

## Contexto

O `systemops-sales-engine` foi construído inicialmente como produto exclusivo para clínicas odontológicas e de estética. O domínio central se chama `Clinic` — o tipo TypeScript, a tabela no banco, os campos `clinicId` — e essa nomenclatura está espalhada por todo o código.

Com a expansão multi-segmento (atelier de costura, cortinas, e qualquer negócio baseado em orçamento e conversão via WhatsApp), o core está sendo posicionado como um **módulo de atendimento especializado em venda e conversão com IA**, acoplado a uma plataforma maior chamada `systemops-platform`. Nesse contexto, o nome `Clinic` se torna um identificador técnico incorreto para o conceito que representa: um **tenant operacional** com canal, agente e catálogo de serviços.

O vocabulário exposto ao LLM já foi abstraído via `PromptContextBuilder` (ADR implícito em multi-segment-evolution.md). O que resta é alinhar o **nome interno do domínio** com o papel real que ele joga na plataforma.

---

## Decisão

Renomear o domínio `Clinic` para `Organization` em **duas camadas independentes**, executadas em momentos diferentes.

### Camada 1 — TypeScript (próxima sessão de desenvolvimento)

Escopo: apenas renomeação de identificadores no código TypeScript. Sem toque em banco, migrations ou URLs.

| Antes | Depois |
|---|---|
| `type Clinic` | `type Organization` |
| `buildClinic(row)` | `buildOrganization(row)` |
| `clinicId: string` (parâmetros de função) | `organizationId: string` |
| `import { Clinic }` | `import { Organization }` |

**O campo `clinicId` no banco de dados NÃO muda nesta camada.** O mapeamento entre o nome do campo no DB e o nome do campo no tipo TypeScript é feito no `buildOrganization()` e pode usar um alias sem renomear a coluna.

Arquivos afetados: ~25 arquivos com o tipo `Clinic`, ~199 com `clinicId` como parâmetro de função.  
Risco: **baixo** — o compilador TypeScript garante completude.  
Esforço estimado: meio dia.

### Camada 2 — Banco de dados (futuro, pós-staging com CI)

Escopo: renomear a tabela `clinics` → `organizations` e o campo `clinic_id` → `organization_id` em todas as tabelas do schema.

Pré-requisito obrigatório: **staging com CI testando a migration antes de prod** (ver backlog `backlog-staging-ci-migrations.md`).

Impacto:
- 48 FKs no schema Drizzle
- 119 referências em migrations SQL existentes
- 2 rotas de URL em produção: `/owner/clinics/` e `/api/owner/clinics/`
- Dados reais da Ximendes em produção — migration deve ser transacional e testada em staging antes

Estratégia de execução quando chegar o momento:
1. Criar tabela `organizations` como alias/view de `clinics` temporariamente
2. Migrar código para ler de `organizations`
3. Remover `clinics` após validação em produção
4. OU fazer rename transacional com zero-downtime via blue-green deploy

Risco: **médio-alto se feito sem staging/CI**, **baixo se feito com staging/CI**.  
Esforço estimado: 1-2 dias.

---

## Alternativas consideradas

### Manter `Clinic` para sempre
Descartado. O nome técnico incorreto cria fricção para desenvolvedores novos e para a integração com a `systemops-platform`, onde o módulo precisa se identificar com vocabulário neutro.

### Renomear tudo de uma vez (camadas 1 e 2 juntas)
Descartado para este momento. Sem staging com CI, o risco de migration mal aplicada derruba a Ximendes em produção. O benefício não justifica o risco imediato.

### Usar `Workspace` ou `Tenant`
Considerado. `Organization` foi preferido porque:
- Alinha com o vocabulário da maioria dos SaaS B2B (Stripe, Linear, Vercel usam `Organization`)
- É o termo esperado por integrações futuras da platform
- `Tenant` é jargão técnico de infra, não de produto
- `Workspace` implica colaboração síncrona, que não é o foco do core

---

## Consequências

**Positivas:**
- Código do `systemops-sales-engine` se auto-documenta corretamente como módulo genérico
- Integração com `systemops-platform` usa vocabulário consistente desde o início
- Novos desenvolvedores entendem imediatamente que `Organization` representa qualquer tipo de negócio

**Negativas / trade-offs:**
- A camada 1 gera um PR grande de renomeação — necessário revisar com atenção
- Enquanto a camada 2 não é feita, há inconsistência entre o nome TypeScript (`Organization`) e o nome no banco (`clinic_id`) — documentar no `buildOrganization()` com comentário explicando o mapeamento intencional

---

## Leitura complementar

- `docs/product/multi-segment.md` — diagnóstico de gaps do sistema atual
- `docs/product/multi-segment-evolution.md` — plano de evolução do core
- `docs/operations/backlog-staging-ci-migrations.md` — pré-requisito para camada 2
- `docs/architecture/target-architecture.md` — arquitetura 2.0
