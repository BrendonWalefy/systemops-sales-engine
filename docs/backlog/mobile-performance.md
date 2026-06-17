# Backlog: Mobile Performance & PWA Enhancement

> **Branch**: `feat/mobile-performance-optimization`
> **Criado**: 2026-06-16
> **Objetivo**: Eliminar lentidão no mobile, melhorar experiência PWA
> **Status**: ✅ Completo (2026-06-16)

## Diagnóstico

A lentidão no mobile vem de:
1. `InboxPoller` faz `router.refresh()` a cada 5s — re-renderiza a página inteira no servidor
2. `ChatWindow` faz `fetch` de TODAS as mensagens a cada 3s
3. `AgendaClient` polling a cada 30s de todos os eventos
4. CSS monolítico de 122KB (5.704 linhas) — parse lento
5. Sem prefetch de rotas, sem cache no service worker
6. Sem feedback tátil — interações parecem lentas

---

## Fase 1: Performance & Responsividade (impacto direto na lentidão)

### 1.1 — Otimizar InboxPoller (MAIOR IMPACTO)
- **Status**: `[x]` Concluído
- **Problema**: `router.refresh()` a cada 5s causa jank, scroll jump, input focus loss
- **Solução**: Polling leve com `/api/inbox/check` que retorna hash/timestamp. Só faz refresh se dados mudaram.
- **Arquivo**: `src/app/(clinic)/app/inbox/InboxPoller.tsx`
- **Implementado em**:
  - `src/app/api/inbox/check/route.ts`
  - `src/app/(clinic)/app/inbox/inbox-snapshot.ts`
  - `src/app/(clinic)/app/inbox/page.tsx`
- **Notas**:
  - Poll continua a cada 5s, mas agora consulta um snapshot leve da inbox.
  - `router.refresh()` só dispara quando a assinatura muda.
  - Mantido fallback de refresh a cada 60s para estados dependentes da passagem do tempo.

### 1.2 — Otimizar ChatWindow Polling
- **Status**: `[x]` Concluído
- **Problema**: Baixa TODAS as mensagens a cada 3s
- **Solução**: Endpoint `?after=<lastMessageId>` que retorna só mensagens novas
- **Arquivos**: `src/app/(clinic)/app/inbox/[conversationId]/ChatWindow.tsx`, `src/app/api/conversations/[id]/messages/route.ts`
- **Notas**:
  - `ChatWindow` agora envia `?after=<ultimoId>` quando já tem histórico carregado.
  - A rota continua compatível com fetch completo quando `after` não é enviado.
  - Merge no cliente evita duplicatas quando houver refresh do servidor junto com polling.

### 1.3 — CSS Touch Optimizations
- **Status**: `[x]` Concluído
- **Problema**: 300ms tap delay, sem active states táteis, sem will-change
- **Solução**: `touch-action: manipulation`, active states otimizados, content-visibility
- **Arquivo**: `src/app/globals.css`
- **Notas**:
  - Adicionado `touch-action: manipulation` para alvos interativos.
  - Estados `:active` e `will-change` reforçados em controles mobile mais tocados.
  - `content-visibility: auto` aplicado em cards/listas pesadas do mobile.

### 1.4 — Prefetch de Rotas
- **Status**: `[x]` Concluído
- **Problema**: Navegação entre páginas é lenta porque carrega tudo on-demand
- **Solução**: Garantir que `<Link>` do Next.js usa prefetch (default no App Router)
- **Arquivos**: Componentes de navegação
- **Notas**:
  - `SidebarNav` faz prefetch explícito das rotas principais e de settings.
  - Links críticos do nav e do sheet mobile agora usam `prefetch`.

### 1.5 — Haptic Feedback
- **Status**: `[x]` Concluído
- **Problema**: Tap não dá feedback — parece que nada aconteceu
- **Solução**: Utility `haptic()` + aplicar nos botões principais
- **Arquivo**: `src/lib/haptic.ts` (novo)
- **Notas**:
  - Utility cliente com fallback silencioso quando `navigator.vibrate` não existe.
  - Aplicado nos controles móveis principais: navegação, sheet de ajustes, avatar e ativação de notificações.

---

## Fase 2: PWA Enhancement

### 2.1 — Service Worker Cache Strategy
- **Status**: `[x]` Concluído
- **Problema**: PWA abre do zero toda vez, sem cache
- **Solução**: Cache do app shell (CSS, JS, fontes) + offline fallback
- **Arquivo**: `public/sw.js`
- **Notas**:
  - `sw.js` já existia para push; foi ampliado para app shell cache + runtime cache de assets estáticos.
  - Navegações usam fallback offline estático sem cachear agressivamente páginas autenticadas.
  - Corrigido path dos ícones de notificação para os arquivos realmente existentes em `public/icons/`.

### 2.2 — Push Notifications UI
- **Status**: `[x]` Concluído
- **Problema**: Backend de push existe mas não há UI para ativar
- **Solução**: Botão no sheet de settings + subscription management
- **Notas**:
  - Já existia botão de ativação no header do inbox.
  - Agora também existe gerenciamento em settings: permissão, estado local da inscrição, ativar, desativar e atualizar status.
  - O toggle atua por dispositivo/navegador, sem afetar outros operadores.

### Pendência Extra — Agenda Polling
- **Status**: `[x]` Concluído
- **Problema**: `AgendaClient` ainda faz refresh periódico completo dos eventos/bloqueios
- **Solução**: aplicar estratégia incremental semelhante à inbox ou migrar direto para SSE
- **Arquivos**: `src/app/(clinic)/app/agenda/AgendaClient.tsx` e rotas relacionadas
- **Implementado em**:
  - `src/app/api/appointments/check/route.ts`
  - `src/app/(clinic)/app/agenda/agenda-snapshot.ts`
  - `src/app/(clinic)/app/agenda/AgendaClient.tsx`
- **Notas**:
  - Poll de 30s agora consulta `/api/appointments/check` (query leve, sem joins) e só refaz o fetch completo de eventos quando a assinatura mudar.
  - Bloqueios saíram do poll periódico: só mudam por ação manual nesta própria tela (criação de bloqueio), que já dispara `refreshAll()` diretamente. IA/orquestrador nunca cria bloqueios.
  - Poll pausa quando a aba está oculta (`document.hidden`).

### 2.3 — Skeleton Loading no Chat
- **Status**: `[x]` Concluído
- **Solução**: Usar classe `.skeleton` existente no ChatWindow
- **Arquivo**: `src/app/(clinic)/app/inbox/[conversationId]/loading.tsx`
- **Notas**:
  - Loading route da conversa agora renderiza header, bolhas e input em skeleton.
  - Reaproveita a linguagem visual já existente do inbox/chat.

---

## Fase 3: Real-time

### 3.1 — Endpoint SSE
- **Status**: `[x]` Concluído
- **Solução**: `/api/events/stream` com Server-Sent Events
- **Arquivo**: `src/app/api/events/stream/route.ts`
- **Notas**:
  - Stream único cobrindo inbox + agenda (janela fixa de -7/+90 dias), tick de 4s, auto-fechamento em 270s (margem segura sob o limite de função do Vercel) com reconexão transparente do `EventSource`.
  - Reaproveita os builders de assinatura já existentes (`get-inbox-snapshot-signature.ts`, `get-agenda-snapshot-signature.ts`) — sem duplicar query.

### 3.2 — Substituir Polling por SSE
- **Status**: `[x]` Concluído
- **Depende de**: 3.1
- **Arquivos**: `src/components/realtime-events-provider.tsx`, `src/app/(clinic)/layout.tsx`, `InboxPoller.tsx`, `AgendaClient.tsx`
- **Notas**:
  - Conexão única montada no layout compartilhado (`RealtimeEventsProvider`); Inbox e Agenda consomem via `useRealtimeEvents()`.
  - Fallback automático (poll a cada 15s/30s) se a conexão cair; fecha o stream quando a aba fica oculta para não manter o Neon acordado sem necessidade.
  - Validado em produção (Vercel): headers corretos (`text/event-stream`, sem buffering), push real sem F5, ciclo de auto-reconexão observado no Network (3 gerações de conexão, todas `200 eventsource`).

---

## Log de Execução

| Data | Item | Commit | Notas |
|------|------|--------|-------|
| 2026-06-16 | 1.1 InboxPoller smart polling | local | Criado `/api/inbox/check` + assinatura estável da inbox; refresh completo agora só roda quando há mudança real ou no fallback temporal de 60s. |
| 2026-06-16 | 1.2 ChatWindow incremental polling | local | `GET /api/conversations/[conversationId]/messages` aceita `?after=<messageId>` e o chat passa a anexar só mensagens novas. |
| 2026-06-16 | 1.3 CSS touch optimizations | local | `touch-action`, `:active`, `will-change` e `content-visibility` aplicados aos alvos mobile de maior custo. |
| 2026-06-16 | 1.4 Prefetch de rotas | local | Prefetch explícito das rotas principais e de settings na navegação clínica mobile/desktop. |
| 2026-06-16 | 1.5 Haptic feedback utility | local | Criado `src/lib/haptic.ts` e integrado aos controles móveis principais com fallback seguro. |
| 2026-06-16 | 2.1 Service worker cache strategy | local | `public/sw.js` passou de push-only para app shell/runtime cache com fallback offline seguro para navegações. |
| 2026-06-16 | 2.2 Push notifications UI | local | Settings agora mostra permissão, inscrição local e ações para ativar/desativar notificações neste dispositivo. |
| 2026-06-16 | 2.3 Skeleton loading no chat | local | Adicionado `loading.tsx` da conversa com skeleton de header, mensagens e composer usando a classe global existente. |
| 2026-06-16 | Pendência Extra — Agenda smart polling | local | Criado `/api/appointments/check` + assinatura leve de agendamentos; `AgendaClient` só refaz fetch completo quando a assinatura muda, e bloqueios saíram do poll periódico (só mudam por ação manual). |
| 2026-06-16 | 3.1+3.2 SSE real-time (inbox+agenda) | 3994a57 | `RealtimeEventsProvider` com stream único no layout; fallback automático e fechamento ao ocultar aba; validado em produção (Vercel) com Network mostrando ciclo de reconexão e push real sem F5. |
