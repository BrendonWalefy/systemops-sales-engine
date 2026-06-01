# Auditoria UX - SystemOps Web

Data: 2026-06-01
Branch local: `fix/app-ux-polish`
Base de comparação: `main`

Este documento consolida os achados da auditoria UX das telas principais e registra o que foi ajustado localmente antes de subir para `main`.

## O Que Ainda Nao Subiu Para `main`

Arquivos alterados localmente nesta branch:

- `next-env.d.ts`
- `src/__tests__/InboxFilter.test.ts`
- `src/app/(clinic)/app/agenda/page.tsx`
- `src/app/(clinic)/app/dashboard/page.tsx`
- `src/app/(clinic)/app/inbox/InboxClient.tsx`
- `src/app/(clinic)/app/inbox/page.tsx`
- `src/app/(clinic)/app/settings/playbook/ia-settings-client.tsx`
- `src/app/(clinic)/app/settings/playbook/simulate/page.tsx`
- `src/app/(clinic)/app/settings/playbook/simulate/simulate-client.tsx`
- `docs/development/ux-audit-systemops-web-2026-06-01.md`

## Resumo Dos Ajustes Implementados

### Dashboard

1. KPI "Economia de Tempo" - badge de trend confuso
Status: implementado.

O badge passou a mostrar unidade: `{agentMessageCount} msgs`. O texto auxiliar tambem ficou mais explicito: `~2min economizados por resposta da IA`.

2. "Leads Quentes" mostra dois numeros diferentes sem explicacao
Status: implementado.

O badge agora deixa claro que `activeHotCount` representa leads quentes `em conversa`, enquanto o valor principal segue como total de leads quentes. O texto auxiliar virou `total · {activeHotCount} ativos agora`.

3. Alert pill de intervencoes no dashboard
Status: ajustado/validado.

O pill ja apontava para `/app/inbox?filter=attention` em `main`, mas usava `<a>`. Foi trocado para `Link` do Next para manter navegacao interna correta e resolver lint.

4. "Leads Recentes" sem link para o Inbox
Status: ja resolvido em `main`.

O painel ja possui CTA `Ver todos` para `/app/inbox`.

5. "Fora do horario" sem contexto de acao
Status: implementado.

O insight foi renomeado para `msgs fora do horário atendidas pela IA`, deixando claro o que a metrica representa.

### Inbox

6. Botao de alerta redundante com a aba "Requer Atencao"
Status: ja resolvido em `main`.

A interface atual usa badge numerico dentro da aba `Requer Atenção`; nao ha botao separado redundante no topbar.

7. `ScheduledCard` nao mostra a data do agendamento
Status: implementado.

O card de agendados agora recebe `appointmentStartsAt` e exibe data/hora da consulta. A busca considera apenas appointments com status `scheduled` ou `confirmed`.

8. Preview de mensagem nao distingue quem enviou por ultimo
Status: implementado.

O preview da conversa agora inclui prefixo por autor:

- `IA:`
- `Operador:`
- `Lead:`

9. "Agendados & Encerrados" agrupa intencoes distintas
Status: pendente.

O agrupamento ainda existe. Recomenda-se separar em secoes distintas, por exemplo `Agendados`, `Pausados manualmente`, `Ganhas` e `Perdidas`, ou ao menos separar consultas futuras de conversas encerradas.

### Agenda

10. Pagina "Agenda" mostra apenas bloqueios
Status: pendente.

A tela continua focada em bloqueios de indisponibilidade. A oportunidade maior segue aberta: adicionar uma secao `Proximas consultas` com eventos/appointments reais.

11. Formulario antes da lista no mobile
Status: pendente.

O DOM ainda coloca o formulario de novo bloqueio antes da lista. Para mobile, a lista deveria aparecer antes do formulario.

12. "Proximo bloqueio" quando nao ha bloqueios
Status: implementado.

Quando nao ha bloqueios, o card exibe:

- valor: `Agenda livre`
- label: `nenhum bloqueio nos próximos 60 dias`

### Configuracoes Da IA

13. Tab inicial padrao e "Playbooks", nao "Comportamento"
Status: ja resolvido em `main`.

A tela atual ja inicia em `Comportamento`.

14. Pills de status no header sao read-only
Status: implementado parcialmente.

Os pills foram convertidos em botoes e levam para a aba `Comportamento`. Ainda nao ha scroll automatico ate o campo especifico de cada pill.

### Simulador

15. Breadcrumb desatualizado
Status: ja resolvido em `main`.

O breadcrumb atual ja mostra `Configurações > Playbooks > Simular`.

16. Quick prompts hardcoded e genericos
Status: implementado.

O simulador agora recebe `menuItems` da clinica e gera prompts rapidos a partir dos itens habilitados. Quando o menu nao existe, usa `DEFAULT_MENU_ITEMS` como fallback. Os prompts tambem aproveitam o `label` configurado pela clinica para ficar mais contextual.

Exemplos:

- `Formas de pagamento` -> `Quero saber sobre formas de pagamento`
- `Avaliação inicial` -> `Quero agendar avaliação inicial`
- `Localização` -> `Quero informações sobre localização`

## Checklist Para Verificacao Manual

Antes de abrir PR ou aprovar merge, verificar no navegador:

- Dashboard: badge de `Economia de Tempo` mostra unidade `msgs`.
- Dashboard: card de `Leads Quentes` diferencia total e ativos em conversa.
- Dashboard: pill de intervencoes abre `/app/inbox?filter=attention`.
- Dashboard: insight fora do horario esta compreensivel.
- Inbox: aba `Requer Atenção` mostra badge vermelho quando houver handoff.
- Inbox: cards ativos mostram prefixo `IA:`, `Operador:` ou `Lead:` no preview.
- Inbox: cards agendados mostram data/hora da consulta.
- Inbox: appointments cancelados/completados nao aparecem como data de consulta ativa no card.
- Agenda: sem bloqueios, resumo mostra `Agenda livre`.
- Configuracoes da IA: pills do header sao clicaveis e mudam para a aba `Comportamento`.
- Simulador: prompts rapidos refletem `menuItems` configurados da clinica.
- Simulador: clinica sem `menuItems` usa os prompts padrao de fallback.

## Verificacao Automatizada

Comandos usados para validar:

```bash
npm run verify
```

Resultado local: lint, typecheck e testes passaram. O lint ainda imprime um warning antigo em `src/app/(clinic)/app/settings/playbook/[id]/editor-client.tsx` sobre `greetingMessage` nao usado, sem falhar o comando.

Observacao: alguns testes imprimem `stderr` de falhas simuladas, mas terminam passando. Isso faz parte dos cenarios de tolerancia a falhas.
