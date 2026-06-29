# Sources of Truth — Mapa de Donos

Atualizado em 2026-06-28.

## Regra central

**Se você precisar mudar uma regra em mais de um lugar, a arquitetura está errada.**

Cada tipo de informação tem um único dono. A duplicação mais perigosa é entre:

- código determinístico e prompt;
- `clinics` e `playbook_versions`;
- `clinic_modules` e flags soltas em outros lugares.

## 1. Conteúdo editorial

**Dono:** `playbook_versions`  
**Porta de acesso:** `resolveActiveEditorialConfig(clinicId)`

Aqui vivem:

- tom de voz;
- especialidade apresentada ao lead;
- política comercial;
- objeções;
- playbook livre;
- biblioteca de mídia;
- procedimentos expostos ao LLM.

O código injeta esse conteúdo em runtime. O prompt **não** deve reescrever como
texto fixo a política comercial, o tom ou a identidade da clínica.

## 2. Configuração operacional do tenant

**Dono:** `clinics`

Campos centrais lidos em runtime:

| Campo | Consumidor principal | Papel |
| --- | --- | --- |
| `timezone` | `ClinicTimezone` | Conversão local e saudação |
| `businessHours` | `SlotEngine` | Disponibilidade |
| `defaultAppointmentDurationMinutes` | `ConversationOrchestrator` | Duração padrão |
| `postAppointmentBufferMinutes` | `SlotEngine` | Buffer pós-atendimento |
| `takeoverTtlHours` | orquestrador / rotas inbox | Retomada após handoff |
| `menuItems` | orquestrador / simulate | Menu conversacional |
| `greetingMessage` | menu / playbook / simulate | Saudação base |
| `autoReplyEnabled` | policy de automação | Liga/desliga a IA |
| `calendarMode` | `resolveCalendarGateway()` | Fonte de verdade da agenda |
| `googleCalendarId` | gateway Google | Integração opt-in |
| `zapi*`, `meta*` | channel adapters | Credenciais do canal |
| `specialty` | prompts e UI | Contexto humano do negócio |
| `segment` | onboarding / expansão | Tipo de operação |
| `serviceNoun` | UI / playbook | Terminologia por segmento |
| `monthlyRevenueBrl`, `billingStartedAt`, `plan` | owner finance / blueprint | Estado comercial |
| `calendarChannelId`, `calendarSyncToken` | Google webhook / renew cron | Sync com Google |

## 3. Capability flags e módulos

**Dono:** `clinic_modules`  
**Porta de acesso:** `src/application/modules/module-gate.ts`

Aqui vivem capacidades opcionais por tenant, por exemplo:

- `concierge_mode`
- `voice_tts`
- `voice_elevenlabs`
- `revenue_pipeline`

Regra: se uma feature depende de plano ou ativação por tenant, o dono é
`clinic_modules`, não `clinics`.

### Casos importantes

- modo de conversa (`menu_first` vs `concierge`) deriva do módulo
  `concierge_mode`;
- saída por voz deriva dos módulos `voice_tts` e `voice_elevenlabs`;
- config de voz vive em `clinic_modules.config`, não em colunas soltas na
  clínica.

## 4. Catálogo comercial e fluxo por serviço

**Dono:** `treatments`

Aqui vivem:

- nome do serviço;
- duração;
- descrição;
- aliases;
- preço ou faixa de preço;
- `requiresEvaluationFirst`;
- `isAesthetic`;
- `pipelineSteps`;
- `triggerTemplate`.

Se a regra varia por serviço, ela não pertence ao playbook geral nem ao
orquestrador.

## 5. Agenda

**Dono de agendamentos:** `appointments`  
**Dono de bloqueios:** `calendar_blocks`  
**Porta de acesso:** `BookingService` + `CalendarGateway`

Regras:

- disponibilidade nunca é inferida direto da UI;
- criação/cancelamento/reagendamento passam por `BookingService`;
- timezone sempre passa por `ClinicTimezone`.

## 6. Pipeline de mensagens

**Dono do que entrou:** `inbound_events`  
**Dono do trabalho pendente:** `jobs`  
**Dono da intenção de envio:** `outbound_messages`  
**Dono do histórico humano da conversa:** `messages`

Regra:

- payload bruto do canal pertence ao inbox (`inbound_events`);
- retry operacional pertence à fila (`jobs`);
- retry de entrega não deve recomputar a conversa; por isso o dono é a outbox
  (`outbound_messages`).

## 7. Comportamento universal do LLM

**Dono:** `src/core/intelligence/`

Arquivos centrais:

- `IntentClassifier.ts`
- `ResponseComposer.ts`
- `PlaybookAdvisor.ts`

O LLM pode:

- classificar intenção;
- verbalizar um resultado já decidido;
- sugerir melhorias editoriais.

O LLM não é dono de:

- booking;
- handoff;
- disponibilidade;
- tenant resolution;
- auth;
- retry;
- policy de automação.

## 8. Tempo e timezone

**Dono:** `src/core/scheduling/ClinicTimezone.ts`

Nunca:

- usar offset manual (`UTC-3`, `-3`);
- duplicar saudação temporal em prompt;
- usar `new Date().getHours()` como regra de negócio local da clínica.

## 9. Invariantes importantes

- `IntentClassifier` e `ResponseComposer` devem usar a mesma janela recente de
  histórico.
- `Reservation TTL` não pode ser menor que o TTL da oferta de slot.
- regras editoriais e regras operacionais não podem viver na mesma prosa livre.
- uma capability opcional deve ter um único gate de leitura.

## Checklist antes de criar regra nova

1. Isso varia por tenant?
2. Isso varia por serviço?
3. Isso é conteúdo editorial ou política operacional?
4. Isso já existe em `clinics`, `clinic_modules`, `treatments` ou
   `playbook_versions`?
5. O valor está sendo declarado em código e prompt ao mesmo tempo?

Se a resposta para 5 for sim, a modelagem está errada.
