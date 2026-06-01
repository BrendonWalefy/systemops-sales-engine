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
- `src/app/globals.css`
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
Status: implementado.

O bucket unico foi separado em secoes operacionais:

- `Agendados`: somente leads com `appointment_scheduled`.
- `Pausados manualmente`: conversas com IA pausada sem handoff.
- `Encerrados`: leads `won` ou `lost`.

A aba `Agendados` agora mostra apenas consultas agendadas, sem misturar pausas ou encerramentos.

### Agenda

10. Pagina "Agenda" mostra apenas bloqueios
Status: implementado.

A tela agora abre com `Próximas consultas`, usando `appointments` locais com status `scheduled` ou `confirmed`, ordenados por `startsAt` futuro. Os bloqueios continuam abaixo como indisponibilidades usadas pela IA.

11. Formulario antes da lista no mobile
Status: verificado/resolvido.

O DOM ainda mantém o formulario antes da lista, mas o CSS responsivo aplica `order` nos paineis: em telas menores, `Bloqueios ativos` aparece antes de `Novo bloqueio`. Nao foi necessario alterar markup.

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
Status: implementado.

Os pills foram convertidos em botoes e agora levam para a aba `Comportamento`, fazem scroll ate o bloco correto e focam o input relacionado:

- `Pausa Automática` -> `takeoverTtlHours`
- `Intervalo` -> `postAppointmentBufferMinutes`
- `Horário` -> `businessHours`

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
- Inbox: `Agendados`, `Pausados manualmente` e `Encerrados` aparecem como secoes separadas.
- Agenda: `Próximas consultas` aparece acima dos bloqueios quando houver appointments futuros.
- Agenda: sem bloqueios, resumo mostra `Agenda livre`.
- Agenda mobile/tablet: lista de bloqueios aparece antes do formulario.
- Configuracoes da IA: pills do header sao clicaveis, mudam para a aba `Comportamento`, rolam ate o campo certo e focam o input.
- Simulador: prompts rapidos refletem `menuItems` configurados da clinica.
- Simulador: clinica sem `menuItems` usa os prompts padrao de fallback.

## Verificacao Automatizada

Comandos usados para validar:

```bash
npm run verify
```

Resultado local: lint, typecheck e testes passaram. O lint ainda imprime um warning antigo em `src/app/(clinic)/app/settings/playbook/[id]/editor-client.tsx` sobre `greetingMessage` nao usado, sem falhar o comando.

Observacao: alguns testes imprimem `stderr` de falhas simuladas, mas terminam passando. Isso faz parte dos cenarios de tolerancia a falhas.
