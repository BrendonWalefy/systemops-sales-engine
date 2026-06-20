# TODO — Funil, Agenda, Dashboard e Produção

Data: 2026-06-20
Branch atual: `feat/inbox-conversation-categories`

## Já implementado nesta branch

- Nova categoria de conversa: `sales`, `operational`, `vendor`, `spam`, `archived`
- Inbox separado por categoria
- Ação no chat para recategorizar conversa
- Conversas fora de `sales` não entram mais em:
  - follow-up comercial
  - recovery campaign
  - KPIs principais de clinic dashboard
  - KPIs principais de owner dashboard
- Chip rápido de `Desconto` voltou no composer
- `Pausar IA` saiu da barra de sugestões do composer
- Migration gerada:
  - `drizzle/0035_married_carlie_cooper.sql`
- Funil pós-agendamento corrigido:
  - `no_show` agora leva o lead para `follow_up_due`
  - `cancelled` agora leva o lead para `follow_up_due`
  - `scheduled` / `confirmed` restauram `appointment_scheduled` e limpam `nextActionAt`
  - inbound de lead em `follow_up_due` ou `lost` reabre para `in_conversation`
- Nova régua automática de follow-up para cancelamento:
  - trigger `appointment_cancelled`
  - reason `Lead cancelou a consulta`
  - due em `+2 dias`
- Inbox agora separa melhor conversa ativa vs recuperação:
  - status visual baseado no último outcome do agendamento
  - `cancelled` e `no_show` saem da leitura de “IA respondendo / em conversa” enquanto o lead não responder depois
  - se o lead responde após o cancelamento/no-show, o card volta a comportamento de conversa ativa
  - pipeline vai para `Agendar` em `cancelled` / `no_show`
  - badge agora mostra `Cancelou`, `Não compareceu`, `Consulta confirmada`, `Em recuperação`
- Inbox aceita query params de navegação:
  - `/app/inbox?filter=attention`
  - `/app/inbox?filter=recovery`
  - `/app/inbox?scope=operational`
- Agenda ajustada:
  - abre por padrão em `Mês`
  - bloqueios longos/full-day ganham background no calendário mensal
  - visão `Profissionais` não mostra mais coluna `Sem profissional` vazia
  - cabeçalho da visão `Profissionais` agora alinha com as colunas reais
- Dashboard reorganizado:
  - `follow_up_due` renomeado visualmente para `Recuperação`
  - card operacional de `Recuperação prioritária`
  - card operacional de `Intervenção humana`
  - cards operacionais convivem com `Consultas de hoje`
  - gráfico principal ficou mais compacto
- Verificação concluída:
  - `npm run verify` ✅
  - `npm run verify:agenda` ✅

## Pendências abertas pedidas pelo usuário

### 1. Produção

- Status final:
  - branch de trabalho consolidada em `develop`
  - `develop` promovida para `main`
  - produção publicada em:
    - commit `c79428f`
    - deploy Vercel `dpl_CeDWM91vRwohMhXtEFLN8xKpb2h1`
    - URL canônica: `https://systemops-core.vercel.app`
- Migração de produção:
  - o ambiente estava com `SKIP_VERCEL_MIGRATIONS=true`, então a migration não rodava no build
  - a execução direta de `scripts/migrate.ts` falhou inicialmente por drift antigo no ledger do Drizzle
  - foi criado o script operacional `scripts/repair-prod-migration-history.ts`
  - repair executado com sucesso via GitHub Actions:
    - run `27865851429`
  - validação do trilho normal de migrations executada com sucesso em seguida:
    - run `27865873148`
- Tentativas anteriores que falharam e já estão superadas:
  - run `27865636973`
  - run `27865775298`

### 2. Regras de negócio do funil pós-agendamento

Regra implementada:

- `confirmed`
  - mantém / restaura `appointment_scheduled`
  - badge do inbox: `Consulta confirmada`
  - pipeline: `Fechado`
- `scheduled`
  - mantém / restaura `appointment_scheduled`
  - badge do inbox: `Consulta marcada`
  - pipeline: `Fechado`
- `cancelled`
  - vira `follow_up_due`
  - follow-up automático em `+2 dias`
  - badge do inbox: `Cancelou`
  - pipeline: `Agendar`
  - sai de `Quentes`/ativo e vai para `Recuperação`
  - se o lead responder depois, volta a conversa ativa
- `no_show`
  - vira `follow_up_due`
  - follow-up automático em `+7 dias`
  - badge do inbox: `Não compareceu`
  - pipeline: `Agendar`
  - sai de `Quentes`/ativo e vai para `Recuperação`
  - se o lead responder depois, volta a conversa ativa
- `completed`
  - vira `won`
  - follow-up de rotina em `+6 meses`
  - sai do live inbox comercial

Leitura esperada para os casos do usuário:

- Bianca `no_show` sem nova resposta do lead:
  - deve ficar em `Recuperação`
  - não deve aparecer como `Em conversa`
- Brendon cancelado em 16/06:
  - se ninguém respondeu depois, deve ficar em `Recuperação`
  - se o lead voltou a falar depois do cancelamento, pode voltar para conversa ativa
- Marjorie `no_show`:
  - não deve mais ficar parada em `Qualific.` / `Quente` ativo
- Gregorie `no_show`:
  - não deve mais aparecer como `IA respondendo` até que o lead reabra a conversa
- Carla com retorno futuro agendado:
  - continua correta como `Consulta marcada` / `Consulta confirmada`

### 3. Dashboard / Home

Entregue:

- bloco operacional com:
  - `Consultas de hoje`
  - `Recuperação prioritária`
  - `Intervenção humana`
- `follow_up_due` passou a alimentar a recuperação operacional
- gráfico principal reduzido para ocupar menos tela

QA pendente em produção:

- validar densidade visual do dashboard com dados reais
- validar se a tabela `Leads Recentes` ainda precisa virar uma lista mais acionável
- validar se a ordem dos cards operacionais faz sentido para o doutor
- avaliar, com uso real, se vale trocar parte da tabela por:
  - ranking de recuperação
  - gargalos do dia
  - leads com maior chance de reagendamento

### 4. Agenda

Entregue:

- visão padrão `Mês` em desktop e mobile
- bloqueios longos/full-day com background para o dia parecer travado
- cabeçalhos e colunas de `Profissionais` alinhados
- `Sem profissional` vazio removido da visão de recursos

QA pendente em produção:

- confirmar o comportamento visual de full-day block com dados reais
- confirmar se o threshold de 12h cobre os bloqueios usados pela clínica

### 5. Revisão visual e funcional

- Validar inbox após mudanças
- Validar agenda mensal e profissionais
- Validar dashboard reorganizado
- Confirmar que chip de desconto aparece em desktop e mobile
- Confirmar que `Pausar IA` não reaparece no composer
- Confirmar que links do dashboard abrem o inbox já filtrado

## Estado final desta entrega

- `cancelled` e `no_show` agora alimentam recuperação em vez de permanecerem como conversa comercial ativa
- conversas não comerciais agora podem ser categorizadas como:
  - `operational`
  - `vendor`
  - `spam`
  - `archived`
- chips comerciais e automações foram limitados a `sales`
- agenda abre em `Mês` por padrão
- visão `Profissionais` ficou alinhada
- bloqueios longos/full-day ficaram visualmente mais claros
- dashboard entrou em produção com cards operacionais mais úteis
- produção está publicada e com schema compatível

## Oportunidades futuras

- separar explicitamente no modelo:
  - estágio comercial do lead
  - outcome operacional do agendamento
  - bucket visual do inbox
- criar automações/atalhos para limpar ruído comercial:
  - arquivar fornecedor
  - marcar spam
  - mover assunto operacional sem deixar contaminar funil
- aprofundar dashboard para conversão:
  - taxa de reagendamento pós no-show
  - taxa de recuperação pós cancelamento
  - fila diária de prioridades ordenada por impacto comercial

## Observações de arquitetura

- Nesta rodada, a correção foi feita sem nova coluna:
  - `lead.status` usa `follow_up_due` como estado comercial de recuperação
  - o inbox deriva o badge visual a partir do último outcome do appointment
- Isso resolve o problema com baixo risco, mas ainda não é o modelo ideal final.
- Evolução futura recomendada:
  - separar explicitamente:
    - estágio comercial do lead
    - outcome operacional do appointment
    - estado visual de fila/inbox
- Cuidado para não voltar a usar `in_conversation` como fallback genérico de cancelamento/no-show.

## Arquivos já tocados nesta frente

- `src/application/use-cases/leads/schedule-follow-up.ts`
- `src/application/use-cases/calendar/update-appointment.ts`
- `src/core/scheduling/BookingService.ts`
- `src/application/use-cases/leads/register-incoming-message.ts`
- `src/app/(clinic)/app/inbox/InboxClient.tsx`
- `src/app/(clinic)/app/inbox/inbox-presentation.ts`
- `src/app/(clinic)/app/inbox/[conversationId]/ConvComposer.tsx`
- `src/app/(clinic)/app/inbox/[conversationId]/page.tsx`
- `src/app/(clinic)/app/inbox/[conversationId]/actions.ts`
- `src/app/(clinic)/app/inbox/page.tsx`
- `src/app/(clinic)/app/inbox/inbox-snapshot.ts`
- `src/app/(clinic)/app/inbox/get-inbox-snapshot-signature.ts`
- `src/app/(clinic)/app/dashboard/page.tsx`
- `src/app/(clinic)/app/agenda/AgendaClient.tsx`
- `src/app/(clinic)/app/agenda/CalendarView.tsx`
- `src/app/(clinic)/app/agenda/ResourceDayView.tsx`
- `src/app/(clinic)/app/agenda/agenda-calendar.css`
- `src/app/(owner)/owner/page.tsx`
- `src/app/(owner)/owner/clinics/[clinicId]/page.tsx`
- `src/core/pipeline/ConversationOrchestrator.ts`
- `src/app/api/cron/follow-up-dispatcher/route.ts`
- `src/app/api/cron/recovery-campaign/route.ts`
- `src/infrastructure/db/schema.ts`
- `drizzle/0035_married_carlie_cooper.sql`
