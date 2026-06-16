# UX Redesign — SystemOps Core

Plano de melhoria de UX baseado na análise real do app em produção + código fonte local.

---

## Estado Atual vs Proposta — Antes e Depois

### 📱 Dashboard (Mobile)

````carousel
![ANTES - Dashboard atual: KPIs em scroll horizontal truncado, gráfico SVG custom, métricas secundárias em lista](/Users/brendonwalefy/.gemini/antigravity-ide/brain/c4be69a2-21c8-4de0-a47b-d22ef0d3a6c9/app_dashboard_mobile_1781508015818.png)
<!-- slide -->
![DEPOIS - Dashboard proposto: KPIs em grid 2x2 com ícones coloridos, gráfico com gradiente, métricas com ring charts, bottom nav com glassmorphism](/Users/brendonwalefy/.gemini/antigravity-ide/brain/c4be69a2-21c8-4de0-a47b-d22ef0d3a6c9/improved_dashboard_mobile_1781510282596.png)
````

| Problema atual | Solução proposta |
|---|---|
| KPI cards em scroll horizontal — textos truncados ("Agendament...", "Economia de...") | Grid 2x2 com textos completos e ícones coloridos por tipo |
| Métricas secundárias (autonomia, msgs fora horário) em lista plana sem destaque | Ring chart para autonomia IA + badges visuais com cores |
| Gráfico sem preenchimento gradient — difícil leitura | Area chart com gradient fill + dot markers |
| Bottom nav sem badge de contagem no Inbox | Badge numérico vermelho no ícone Inbox |

---

### 📱 Inbox (Mobile)

````carousel
![ANTES - Inbox atual: cards com progress dots, badges de temperatura e status, barra de busca](/Users/brendonwalefy/.gemini/antigravity-ide/brain/c4be69a2-21c8-4de0-a47b-d22ef0d3a6c9/app_inbox_mobile_1781507909670.png)
<!-- slide -->
![DEPOIS - Inbox proposto: cards com melhor hierarquia visual, barras de accent coloridas, espaçamento otimizado](/Users/brendonwalefy/.gemini/antigravity-ide/brain/c4be69a2-21c8-4de0-a47b-d22ef0d3a6c9/improved_inbox_mobile_1781510345372.png)
````

| Problema atual | Solução proposta |
|---|---|
| Progress dots (pipeline) ocupam espaço mas são pouco legíveis em mobile | Manter mas reduzir tamanho; adicionar barra lateral colorida por urgência |
| Cards sem separação clara de urgência vs normal | Borda lateral red para ATENÇÃO, green para IA ativa |
| Badge "Requer humano" com pouco contraste | Badge com fundo amber sólido + texto branco |
| Search bar genérica | Search com ícone + placeholder contextual |

---

### 📱 Chat/Conversa (Mobile)

![Chat atual: bolhas WhatsApp-style, header com toggle IA, campo de registro de agendamento](/Users/brendonwalefy/.gemini/antigravity-ide/brain/c4be69a2-21c8-4de0-a47b-d22ef0d3a6c9/app_conversation_mobile_1781507946143.png)

| Problema atual | Solução proposta |
|---|---|
| Banner amarelo "Lead quer falar com especialista" no topo é disruptivo | Mover para card acionável com botão de ação inline |
| Sem badge de temperatura no header | Adicionar pill colorida (Quente/Morno/Frio) ao lado do nome |
| "Registrar agendamento" em accordion fechado — escondido | Tornar CTA primário flutuante quando lead mostra intenção de agendar |
| Toggle "Ativar IA" sem feedback visual claro do estado | Pill colorida pulsante: 🟢 "IA Ativa" / 🔴 "IA Pausada" |

---

### 📱 Agenda (Mobile)

![Agenda atual: view Dia com navegação de data, 1 agendamento, fundo claro](/Users/brendonwalefy/.gemini/antigravity-ide/brain/c4be69a2-21c8-4de0-a47b-d22ef0d3a6c9/app_agenda_mobile_1781508270005.png)

| Problema atual | Solução proposta |
|---|---|
| Fundo claro contrasta com dark mode do resto do app | Unificar com dark mode do design system |
| Timeline mostra horas 08-20 mesmo quando vazia — scroll desnecessário | Auto-scroll para horário atual ou próximo agendamento |
| Agendamento card sem informação de tratamento/duração | Card expandido: "Marjorie · Clareamento · 08:20-09:20" |
| Botão "+" pequeno no canto — difícil tap target em mobile | FAB (Floating Action Button) 56px verde no bottom-right |
| Sem visual diferenciador para bloqueios vs agendamentos | Padrão hachurado para bloqueios, cor sólida para agendamentos |

---

### ⚙️ Configurações / Ajustes (Mobile)

````carousel
![Settings drawer: avatar, links para sub-rotas, logout](/Users/brendonwalefy/.gemini/antigravity-ide/brain/c4be69a2-21c8-4de0-a47b-d22ef0d3a6c9/app_settings_drawer_mobile_1781508340157.png)
<!-- slide -->
![Playbook config: toggle IA, experiência, texto de boas-vindas](/Users/brendonwalefy/.gemini/antigravity-ide/brain/c4be69a2-21c8-4de0-a47b-d22ef0d3a6c9/app_settings_playbook_mobile_1781508419451.png)
<!-- slide -->
![Pipeline: lista de tratamentos sem pipeline configurado](/Users/brendonwalefy/.gemini/antigravity-ide/brain/c4be69a2-21c8-4de0-a47b-d22ef0d3a6c9/app_settings_pipeline_mobile_1781509161946.png)
<!-- slide -->
![Profissionais: KPIs zerados, empty state](/Users/brendonwalefy/.gemini/antigravity-ide/brain/c4be69a2-21c8-4de0-a47b-d22ef0d3a6c9/app_settings_profissionais_mobile_1781509493502.png)
````

| Problema atual | Solução proposta |
|---|---|
| Settings acesso apenas via drawer overlay — contexto se perde | Rota dedicada `/app/settings` com navegação por tabs dentro da página |
| Pipeline mostra "Sem pipeline — fluxo reativo padrão" para todos | Indicador visual de % configurado + CTA "Configurar pipeline" com destaque |
| Profissionais vazio mostra 3 cards "0" sem contexto | Empty state com ilustração e wizard "Comece adicionando seu primeiro profissional" |
| Botão "Sair da conta" em vermelho no drawer — UX perigosa | Mover logout para último item da tela de settings, com confirmação |

---

### 🏠 Owner Dashboard

![Owner: KPIs financeiros, clínicas ativas/pausadas, alertas](/Users/brendonwalefy/.gemini/antigravity-ide/brain/c4be69a2-21c8-4de0-a47b-d22ef0d3a6c9/owner_dashboard_mobile_1781507854019.png)

| Problema atual | Solução proposta |
|---|---|
| Cards coloridos em fundo claro destoam do dark mode da clínica | Unificar com dark mode ou ao menos garantir modo consistente |
| KPIs financeiros ($0.0000) mostram formato raw demais | Formatar "R$ 0,06" com moeda brasileira |
| Cards "Ativas/Pausadas/Implantação/Testes" sem hierarquia | Grid 2x2 com ícones e cores semânticas |

---

### 🔐 Login

![Login: card branco central, fundo claro com gradiente](/Users/brendonwalefy/.gemini/antigravity-ide/brain/c4be69a2-21c8-4de0-a47b-d22ef0d3a6c9/login_page_mobile_1781507799854.png)

| Problema atual | Solução proposta |
|---|---|
| Fundo gradiente claro não combina com dark mode do app | Fundo dark com logo + tagline |
| Card branco genérico sem branding | Card com glassmorphism, ícone do SystemOps, gradient border |
| Sem loading state no botão "Entrar" | Spinner + disable no botão durante auth |

---

## Componentes Estruturais Afetados

### [sidebar-nav.tsx](file:///Users/brendonwalefy/Dev/Projetos/systemops-core/src/components/sidebar-nav.tsx)
- **Mobile:** Bottom nav pill já funciona bem. Melhorias: badge de contagem no Inbox, haptic feedback visual no active state
- **Desktop:** Sidebar ícone-only quando colapsada. Expandir on hover com labels
- Adicionar indicador de notificações não-lidas

### [mobile-avatar-menu.tsx](file:///Users/brendonwalefy/Dev/Projetos/systemops-core/src/components/mobile-avatar-menu.tsx)
- Menu drawer com acesso a Configurações, Pipeline, Profissionais — já funciona
- Melhorar: adicionar status da IA (Ativa/Pausada) no drawer header

### [globals.css](file:///Users/brendonwalefy/Dev/Projetos/systemops-core/src/app/globals.css)
- Arquivo central de estilos — todas as mudanças visuais vivem aqui
- Criar design tokens adicionais para consistência dark mode

---

## Proposta de Implementação por Fases

> [!IMPORTANT]
> Fases priorizadas por impacto no dia-a-dia do doutor (mobile-first).

### Fase 1 — Consistência Visual + Dark Mode Unificado
**Impacto: Alto | Esforço: Baixo | Risco: Mínimo**

#### [MODIFY] [globals.css](file:///Users/brendonwalefy/Dev/Projetos/systemops-core/src/app/globals.css)
- Unificar cores: Agenda e Login ainda usam fundo claro
- Adicionar tokens: `--surface-elevated`, `--border-accent`, `--shadow-glow`
- Melhorar contraste de badges (temperatura, status)
- FAB (Floating Action Button) styles para agenda mobile

#### [MODIFY] [sidebar-nav.tsx](file:///Users/brendonwalefy/Dev/Projetos/systemops-core/src/components/sidebar-nav.tsx)
- Adicionar prop `unreadCount` para badge no Inbox
- Melhorar active state com pill background

---

### Fase 2 — Dashboard Mobile Otimizado
**Impacto: Alto | Esforço: Médio**

#### [MODIFY] [page.tsx (dashboard)](file:///Users/brendonwalefy/Dev/Projetos/systemops-core/src/app/(clinic)/app/dashboard/page.tsx)
- KPI cards: mudar de scroll horizontal → grid 2x2
- Adicionar ícones coloridos por tipo de KPI
- Métricas secundárias: ring chart para autonomia IA
- Empty states melhorados com CTAs claros

---

### Fase 3 — Inbox: Hierarquia Visual + Urgência
**Impacto: Alto | Esforço: Médio**

#### [MODIFY] [InboxClient.tsx](file:///Users/brendonwalefy/Dev/Projetos/systemops-core/src/app/(clinic)/app/inbox/InboxClient.tsx)
- Borda lateral colorida por urgência (red/green/neutral)
- Melhorar contraste dos badges
- Otimizar density dos cards para mobile

#### [MODIFY] Conversation detail page
- Badge de temperatura no header
- CTA flutuante de agendamento contextual
- Toggle IA com feedback visual pulsante

---

### Fase 4 — Agenda Dark Mode + Smart Scroll
**Impacto: Médio | Esforço: Médio**

#### [MODIFY] [AgendaClient.tsx](file:///Users/brendonwalefy/Dev/Projetos/systemops-core/src/app/(clinic)/app/agenda/AgendaClient.tsx)
- Dark mode unificado
- Auto-scroll para horário atual
- Cards de agendamento com mais info (tratamento, duração)
- FAB verde para novo agendamento

---

### Fase 5 — Settings Consolidado + Empty States
**Impacto: Médio | Esforço: Baixo**

#### [MODIFY] Settings pages
- Melhorar empty states (Profissionais, Pipeline)
- Reorganizar hierarquia de navegação mobile
- Wizard de onboarding para configurações vazias

---

### Fase 6 — Login + Owner (Polish Final)
**Impacto: Baixo | Esforço: Baixo**

#### [MODIFY] Login page
- Dark mode com glassmorphism
- Loading state no botão

#### [MODIFY] Owner dashboard
- Formato de moeda BR
- Grid consistente

---

## Open Questions

> [!IMPORTANT]
> **Landing Page:** Você começou a dizer "Sobre a landing page, temos um..." mas a mensagem ficou cortada. Pode completar? A LP atual em dental-sync-bot já está bem construída — quer que eu foque apenas nas melhorias de copy (AIDA) e conversion rate, ou tem um plano específico?

> [!IMPORTANT]
> **Agenda fundo claro:** A agenda é a única tela com fundo claro/branco. Isso é intencional (para visualização do calendário) ou deve migrar para dark mode como o resto?

> [!IMPORTANT]
> **Prioridade:** Quer que eu comece pela Fase 1+2 (consistência + dashboard) ou prefere outra ordem?

---

## Verificação

### Checklist pré-merge
```bash
npm run verify
```

### Validação visual
- Testar em viewport 375px, 390px, 428px (iPhones)
- Testar em viewport 1440px (desktop)
- Validar dark mode consistência entre todas as páginas
- Vercel preview deploy para QA manual antes de merge

### Branch
```
feat/ux-mobile-first-redesign
```
