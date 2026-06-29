# Prontidão Multi-Segmento

**Status:** base existente, com limites claros para a 2.0  
**Última revisão:** 2026-06-28

Este documento descreve o que o SystemOps já suporta hoje para operar vários
tenants e vários segmentos, e o que ainda prende o produto ao modelo atual de
"clínica com atendimento via WhatsApp e agendamento".

## Resposta curta

O sistema já é **multi-tenant por design** e já tem uma base relevante para
**multi-segmento configurável por tenant**.

O que ainda não existe é uma abstração de produto realmente neutra para
qualquer operação. Hoje a plataforma continua clinic-centric em nomenclatura,
intents e parte das automações.

## O que já está pronto

### 1. Isolamento por tenant

- `clinicId` está presente nas entidades centrais.
- A entrada do WhatsApp resolve a clínica pela credencial do canal, não por env
  global.
- Owner, membro de clínica e crons resolvem tenant por mecanismos separados e
  explícitos.

### 2. Configuração por tenant no banco

Cada clínica já controla no banco:

- canal (`zapiInstanceId`, `metaPhoneNumberId`, tokens);
- agenda (`calendarMode`, timezone, horários, limites);
- identidade (`specialty`, `segment`, `serviceNoun`);
- conteúdo (`playbook_versions`, política comercial, tom);
- operação (`takeoverTtlHours`, rate limit, slot lookahead, thresholds).

### 3. Modelo relativamente genérico para oferta de serviço

- `treatments` já funciona como catálogo de serviços ofertados;
- `professionals` já funciona como recurso operacional/agendável;
- `pipelineSteps` por tratamento permite fluxos comerciais diferentes por
  serviço;
- `mediaLibrary`, playbook e follow-up são configuráveis por clínica.

### 4. Linguagem adaptável

O schema já tem campos pensados para variar a linguagem do tenant:

- `clinics.specialty`
- `clinics.segment`
- `clinics.serviceNoun`

Isso já permite trocar partes relevantes da UI e do conteúdo sem mudar código
de tenancy.

## O que ainda está clinic-centric

### 1. Nomes de domínio

O core ainda fala em:

- `Clinic`
- `Treatment`
- `Professional`
- `Appointment`

Esses nomes funcionam muito bem para saúde, estética e operações baseadas em
agenda, mas não descrevem igualmente bem outros verticais.

### 2. Intents orientados a recepção/agendamento

O `IntentClassifier` continua centrado em:

- `book_appointment`
- `check_availability`
- `confirm_slot`
- `clinical_urgency`
- `patient_arrived`

Isso é ótimo para clínicas e serviços com agenda, mas não representa de forma
neutra vendas consultivas, suporte, cobrança ou atendimento operacional sem
consulta.

### 3. Parte das automações assume consulta/agendamento

Fluxos como:

- appointment reminder
- follow-up pós-vídeo
- confirmação de consulta
- recovery campaign baseada em lead frio de clínica

ainda são descritos com linguagem e estados centrados em consulta.

## O que a 2.0 deve preservar

Independentemente da nomenclatura nova, a arquitetura 2.0 deveria manter estes
acertos do sistema atual:

1. Resolução de tenant antes de qualquer decisão.
2. Configuração por tenant no banco, não em env global.
3. LLM cercado por decisão determinística.
4. Inbox/outbox e retry seguro para mensagens.
5. Um único dono para cada dado editorial ou operacional.

## O que a 2.0 provavelmente deve abstrair

Se o objetivo for suportar vários segmentos com o mesmo core, estes são os
candidatos mais fortes a abstração:

| Hoje | Possível abstração 2.0 | Observação |
| --- | --- | --- |
| `Clinic` | `Organization` ou `Workspace` | Tenant principal |
| `Treatment` | `Service`, `Offering` ou `CatalogItem` | Catálogo comercial |
| `Professional` | `Resource` | Pessoa, sala ou capacidade |
| `Appointment` | `Booking`, `Reservation` ou `Case` | Nem todo segmento agenda consulta |
| `specialty` | `businessDescriptor` | Descreve o negócio em linguagem humana |

## O que já facilita essa generalização

Mesmo com nomes clinic-centric, a implementação atual já ajuda a 2.0:

- `segment` diferencia o tipo de operação no onboarding;
- `serviceNoun` desacopla parte da UI da palavra "tratamento";
- tratamentos e playbook já são por tenant;
- calendário já é modular via `CalendarGateway`;
- envio de canal já é modular via adapters.

## Gaps reais para a 2.0

Hoje, os principais gaps não são de multi-tenancy; são de neutralidade de
domínio.

### Gaps de linguagem e prompt

- prompts ainda assumem "recepcionista virtual" e contexto de clínica;
- vários exemplos continuam pensando em agenda, avaliação e atendimento em
  saúde/estética.

### Gaps de modelo

- a conversa principal ainda assume funil de lead para marcação;
- automações de cron ainda são descritas com linguagem de consulta;
- algumas regras ainda partem da premissa de que existe agenda como destino
  natural do lead.

### Gaps de produto

- a UI owner/onboarding ainda nasce de templates muito orientados a clínica;
- o dashboard e o blueprint continuam medindo prontidão de operação clínica,
  não de uma operação genérica.

## Recomendação objetiva para a arquitetura 2.0

Não reescrever tenancy. O trabalho principal deve ser:

1. **generalizar o domínio exposto**, não o isolamento por tenant;
2. **separar módulos obrigatórios de módulos opcionais**;
3. **tratar agendamento como capability**, não como pressuposto universal;
4. **manter o pipeline assíncrono de inbox/outbox** como base operacional.

## Módulos que parecem universais

- Tenancy
- Channel adapters
- Inbox/outbox
- Jobs e retry
- Editorial config
- LLM classifier/composer cercados por regra
- Observabilidade

## Módulos que devem virar capabilities

- Scheduling
- Calendar sync
- Appointment reminders
- Clinical urgency
- Treatment pipeline baseado em consulta

## Leitura complementar

- `docs/architecture/current.md`
- `docs/architecture/sources-of-truth.md`
- `docs/architecture/diagrams/README.md`
