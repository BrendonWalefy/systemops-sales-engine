# Task: TTL de Conversa Inativa → `lost`

Implemente um cron job diário que marca automaticamente leads inativos como `lost`
quando não há atividade na conversa por 14 dias.

---

## CONTEXTO DO PROJETO

SaaS de recepcionista autônoma para clínicas. MVP em produção (piloto Ximendes Odontologia).
Stack: Next.js 14 App Router, TypeScript, Drizzle/Neon (Postgres), Vercel.

Clean Architecture:
- src/domain/ — entidades e interfaces (zero dependências externas)
- src/application/ports/ — interfaces de repositório
- src/application/use-cases/ — lógica de negócio
- src/infrastructure/ — implementações concretas (Drizzle)
- src/app/api/ — rotas HTTP thin

---

## PROBLEMA A RESOLVER

Leads que param de responder ficam com status `in_conversation` para sempre.
O Inbox acumula conversas zumbis, as métricas do funil ficam distorcidas, e quando
o lead volta meses depois a IA retoma um contexto completamente desatualizado.

---

## SCHEMA RELEVANTE (já existe, não alterar)

```
leads:
  id, clinicId, status (leadStatusEnum), lostReason (text), updatedAt

leadStatusEnum: "new" | "in_conversation" | "follow_up_due" |
                "appointment_scheduled" | "lost" | "won"

conversations:
  id, clinicId, leadId, lastMessageAt (timestamp nullable), updatedAt
```

`conversations.lastMessageAt` é atualizado a cada mensagem recebida/enviada.
Se for null, usar `conversations.updatedAt` como fallback.

---

## O QUE CONSTRUIR

### 1. Método novo no LeadRepository port
Arquivo: `src/domain/repositories/lead-repository.ts`

Adicionar:
```typescript
findInactiveLeads(params: {
  clinicId: string;
  lastActivityBefore: Date;
}): Promise<Lead[]>;
```

Critério: leads cujo status NÃO seja `lost`, `won` ou `appointment_scheduled`,
com `conversations.lastMessageAt` (ou `conversations.updatedAt` se null) anterior
a `lastActivityBefore`, pertencentes à clínica informada.

### 2. Implementação no DrizzleLeadRepository
Arquivo: `src/infrastructure/repositories/drizzle-lead-repository.ts`

Implementar `findInactiveLeads` com Drizzle:
- Join `leads` com `conversations` on `conversations.leadId = leads.id`
- WHERE `leads.clinicId = clinicId`
- AND `leads.status NOT IN ('lost', 'won', 'appointment_scheduled')`
- AND `COALESCE(conversations.lastMessageAt, conversations.updatedAt) < lastActivityBefore`
- Retorna lista de `Lead` (usando o `mapRow` já existente no arquivo)

### 3. Use case
Criar: `src/application/use-cases/leads/mark-stale-leads.ts`

```typescript
export async function markStaleLeads(params: {
  clinicId: string;
  inactiveDays?: number; // default: 14
}): Promise<{ marked: number }> {
  // 1. Calcula data de corte (now - inactiveDays)
  // 2. Chama leadRepository.findInactiveLeads({ clinicId, lastActivityBefore })
  // 3. Para cada lead: set status = 'lost', lostReason = 'inatividade', updatedAt = now
  // 4. Chama leadRepository.save(lead) — método já existente, faz upsert
  // 5. Retorna { marked: count }
}
```

Instanciar `DrizzleLeadRepository` dentro do use case (mesma estratégia dos outros use cases).

### 4. Rota cron
Criar: `src/app/api/cron/stale-conversations/route.ts`

```typescript
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Proteger com CRON_SECRET
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) return NextResponse.json({ error: "PILOT_CLINIC_ID not set" }, { status: 500 });

  const result = await markStaleLeads({ clinicId });
  console.log(`[StaleConversations] Marcados ${result.marked} leads como lost`);
  return NextResponse.json(result);
}
```

### 5. Configuração do Vercel Cron
Criar: `vercel.json` na raiz do projeto

```json
{
  "crons": [
    {
      "path": "/api/cron/stale-conversations",
      "schedule": "0 6 * * *"
    }
  ]
}
```

`0 6 * * *` = 6h UTC = 3h BRT. Roda diariamente em horário de baixíssimo tráfego.

IMPORTANTE: Vercel Cron chama a rota com header `Authorization: Bearer <CRON_SECRET>`.
A env var `CRON_SECRET` já deve existir no projeto (padrão de segurança do projeto).
Se não existir, criar no painel Vercel e também no `.env.local`.

---

## REGRAS DE IMPLEMENTAÇÃO

1. NUNCA alterar a tabela `leads` diretamente com SQL raw — usar `leadRepository.save(lead)`
2. O método `save` já existe e faz upsert via `onConflictDoUpdate` — basta mutar o campo `status`
3. Leads com `status = 'appointment_scheduled'` NÃO devem ser marcados como lost
   (podem ter consulta futura marcada)
4. `lostReason` deve ser `"inatividade"` (snake_case, sem acento, valor padronizado)
5. Log obrigatório: `console.log` com quantos leads foram marcados (visível nos logs da Vercel)
6. Se `findInactiveLeads` retornar array vazio, retornar `{ marked: 0 }` sem erro
7. A rota cron retorna HTTP 200 em sucesso — Vercel monitora falhas por status != 200

---

## TESTES

Criar: `src/__tests__/StaleConversations.test.ts`

Casos obrigatórios (Vitest — já configurado):

1. **Lead inativo há 15 dias** com status `in_conversation` → marcado como `lost`
2. **Lead inativo há 13 dias** → NÃO marcado (abaixo do threshold de 14 dias)
3. **Lead com status `appointment_scheduled`** inativo → NÃO marcado (tem consulta futura)
4. **Lead com status `lost`** → NÃO marcado novamente
5. **Lead com status `won`** → NÃO marcado
6. **Rota cron sem `CRON_SECRET` correto** → retorna 401
7. **Nenhum lead inativo** → retorna `{ marked: 0 }`, sem erro

Mock: `DrizzleLeadRepository` com `vi.mock`. Padrão em `src/__tests__/ZApiWebhook.test.ts`.

---

## DEPLOY

1. Rodar `npx tsc --noEmit` — zero erros de TypeScript
2. Rodar `npm test` — todos os testes passando (76 existentes + novos)
3. Verificar que `CRON_SECRET` existe nas env vars da Vercel
   (se não existir: criar string aleatória segura, adicionar ao painel Vercel + `.env.local`)
4. Commitar todos os arquivos incluindo `vercel.json`
5. Push para `main` → Vercel faz deploy automático e registra o cron

Validação pós-deploy:
- No painel Vercel → aba "Cron Jobs" → verificar que o job aparece agendado
- Testar manualmente via `curl -H "Authorization: Bearer <CRON_SECRET>" https://<url>/api/cron/stale-conversations`
- Confirmar nos logs da Vercel que a rota respondeu 200 com `{ marked: N }`

---

## ARQUIVOS DE REFERÊNCIA (ler antes de começar)

- `src/domain/repositories/lead-repository.ts` — interface a estender
- `src/infrastructure/repositories/drizzle-lead-repository.ts` — implementação a estender
- `src/infrastructure/db/schema.ts` — tabelas `leads` e `conversations` com todos os campos
- `src/application/use-cases/leads/create-follow-up.ts` — padrão de use case a seguir
- `src/app/api/clinic/auto-reply/route.ts` — exemplo de rota thin com auth simples

---

## CHECKLIST FINAL

- [ ] `findInactiveLeads` adicionado ao port `LeadRepository`
- [ ] `findInactiveLeads` implementado no `DrizzleLeadRepository`
- [ ] Use case `mark-stale-leads.ts` criado
- [ ] Rota cron `src/app/api/cron/stale-conversations/route.ts` criada com auth via `CRON_SECRET`
- [ ] `vercel.json` criado na raiz com schedule `0 6 * * *`
- [ ] `CRON_SECRET` adicionado às env vars da Vercel e ao `.env.local`
- [ ] 7 casos de teste escritos e passando
- [ ] `tsc --noEmit` sem erros
- [ ] `npm test` todos os testes verdes
- [ ] Commit + push para main
- [ ] Cron aparece na aba "Cron Jobs" do painel Vercel
- [ ] Teste manual via curl confirma 200 e `{ marked: N }`
