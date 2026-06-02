# Agenda por profissional: view propria com CSS Grid

Data: 2026-06-02

## Contexto

Queremos avaliar se vale construir uma experiencia parecida com os recursos de
resource calendar/resource scheduler do FullCalendar para atender clinicas com
diversos profissionais, sem depender de uma licenca premium cara.

O projeto hoje ja tem boa parte da base para isso:

- A tabela `professionals` guarda nome, especialidade, cor, agenda de trabalho e
  `googleCalendarId`.
- A tabela `appointments` ja possui `professionalId`, `roomId`, horario de inicio
  e fim, status e vinculo com evento do Google Calendar.
- A API `GET /api/appointments` ja retorna `professionalId`, `professionalName`
  e `professionalColor`.
- A API `PATCH /api/appointments/[id]` ja aceita `professionalId`, entao mover
  um agendamento entre profissionais pode virar uma operacao real no backend.
- A tela atual de agenda usa Schedule-X para semana/dia/mes, com drag and drop
  basico ja conectado ao `PATCH`.

## Decisao recomendada

Construir uma view propria de "dia por profissional" usando CSS Grid, mantendo a
agenda atual como fallback ou como visualizacao semanal/mensal.

A ideia nao e clonar FullCalendar inteiro. O objetivo e criar uma experiencia
focada no uso real da clinica:

- colunas por profissional;
- eixo vertical de horarios;
- eventos coloridos por profissional/status;
- clique em horario livre para agendar;
- bloqueios visiveis;
- scroll horizontal para muitos profissionais;
- layout responsivo para escritorio e recepcao;
- depois, drag and drop entre horario/profissional.

## Por que e viavel

O desafio principal nao e o CSS Grid em si. A parte trabalhosa e garantir uma UX
boa e regras de agenda corretas:

- converter minutos do dia em posicoes verticais estaveis;
- lidar com eventos sobrepostos;
- manter cabecalho e eixo de horarios fixos durante scroll;
- suportar mobile sem ficar inutil;
- lidar com timezone da clinica;
- prevenir double booking;
- sincronizar mudancas com Google Calendar;
- testar as regras deterministicas no backend.

Como o nosso dominio e clinica, a view pode ser menor e mais objetiva que uma
biblioteca generica.

## Comparacao com bibliotecas premium

FullCalendar:

- Recursos padrao sao MIT.
- Timeline View e Vertical Resource View sao Premium.
- Preco oficial verificado em 2026-06-02: Premium "starting at $480".
- Documentacao oficial:
  - https://fullcalendar.io/pricing
  - https://fullcalendar.io/docs/premium
  - https://fullcalendar.io/docs/timeline-view

Schedule-X:

- O projeto ja usa `@schedule-x/calendar`.
- Resource Scheduler e recurso premium.
- Preco oficial verificado em 2026-06-02: plano anual de EUR 479/ano ou lifetime
  de EUR 999 para 2-3 desenvolvedores, mais VAT quando aplicavel.
- Documentacao oficial:
  - https://schedule-x.dev/docs/calendar/resource-scheduler
  - https://schedule-x.dev/premium

Conclusao: comprar uma licenca pode acelerar bastante se precisarmos de um
scheduler completo imediatamente. Mas, para o nosso caso, uma view propria e
tecnicamente viavel e pode ser mais alinhada ao produto.

## MVP sugerido

Primeira entrega:

1. Criar uma visualizacao "Dia por profissional" na agenda.
2. Usar os profissionais ativos como colunas.
3. Adicionar uma coluna "Sem profissional" para agendamentos antigos/importados.
4. Renderizar horarios de trabalho configuraveis, inicialmente 07:00-20:00.
5. Posicionar eventos por `startsAt`/`endsAt`.
6. Mostrar nome do paciente, telefone resumido, status e profissional.
7. Clique em slot livre abre `AppointmentModal` com data, hora e profissional.
8. Clique em evento abre `AppointmentDrawer`.
9. Manter Schedule-X como visualizacao alternativa enquanto a nova view amadurece.

Segunda entrega:

1. Drag and drop dentro da mesma coluna para mudar horario.
2. Drag and drop entre colunas para trocar profissional.
3. Preview visual de slot invalido.
4. Tratamento de erro quando backend retorna `slot_taken`.
5. Atualizacao otimista com rollback visual em caso de falha.

Terceira entrega:

1. Resize de duracao.
2. Filtros por profissional/status.
3. Indicador de "agora".
4. Horarios de trabalho por profissional usando `workSchedule`.
5. Bloqueios por profissional.
6. Impressao/exportacao simples se for importante para recepcao.

## Pontos de atencao antes de producao multi-profissional

O backend precisa garantir regras por profissional de forma deterministica. Hoje
o `PATCH` aceita `professionalId`, mas a revalidacao de disponibilidade ainda
precisa ficar explicitamente profissional-aware quando isso virar comportamento
central.

Itens a revisar:

- `CalendarGateway.isSlotFree` deve receber `professionalId` quando aplicavel.
- `BookingService.book` deve salvar `professionalId` no appointment criado.
- `GoogleCalendarGateway` deve decidir se usa calendario da clinica ou calendario
  do profissional.
- Reservas otimistas de slot precisam considerar profissional quando a clinica
  tiver agendas paralelas.
- Testes de double booking precisam cobrir dois profissionais no mesmo horario.
- Bloqueios precisam deixar claro se bloqueiam a clinica inteira ou apenas um
  profissional.

## Testes esperados

Por envolver agenda, qualquer mudanca real deve manter:

```bash
npm run verify
```

E tambem cobrir os testes de agenda:

```bash
npm test -- src/__tests__/SlotEngine.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/SlotDayPreference.test.ts src/__tests__/ClinicTimezone.test.ts
```

Novos testes importantes:

- permite dois profissionais diferentes no mesmo horario;
- bloqueia dois agendamentos no mesmo profissional e horario;
- mover evento entre profissionais revalida conflito;
- mover evento para horario ocupado retorna `slot_taken`;
- agendamento sem profissional aparece na coluna "Sem profissional";
- clique em coluna de profissional preenche `professionalId` no modal.

## Perguntas para refinamento

- A clinica piloto tera um Google Calendar unico ou um calendario por profissional?
- A recepcao precisa ver dia unico por profissional ou semana por profissional?
- Profissionais podem atender simultaneamente em salas diferentes?
- Bloqueios sao da clinica inteira, do profissional ou da sala?
- A IA deve escolher profissional automaticamente ou apenas oferecer horarios
  livres de qualquer profissional?
- O mobile precisa permitir operacao completa ou apenas consulta rapida?

