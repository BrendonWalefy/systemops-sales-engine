# Fontes de verdade

Atualizado em 2026-08-25.

> Se um fato precisa ser alterado em mais de um lugar, o ownership está errado.

## Mapa de donos

| Categoria | Dono canônico | Acesso principal |
| --- | --- | --- |
| Tenant e operação | `organizations` | entidade `Clinic`/repositório, enquanto a nomenclatura interna é compatível |
| Capabilities e voz | `clinic_modules` | `module-gate` e resolver de voz |
| Conteúdo editorial | `playbook_versions` ativo | `resolveActiveEditorialConfig(clinicId)` |
| Serviço e jornada | `treatments` + `pipelineSteps` | repositório de tratamentos e capabilities/Decision V2 |
| Ofertas | `price_campaigns` | `resolveEffectivePrice` |
| Agenda | `appointments`, `calendar_blocks`, `slot_reservations` | `BookingService` + `CalendarGateway` |
| Conversa | `leads`, `conversations`, `messages`, `conversation_states` | use cases e state machine |
| Evento recebido | `inbound_events` | inbound event store |
| Trabalho pendente | `jobs` | job queue |
| Intenção de envio | `outbound_messages` | outbound message store |
| Authority conversacional live | `conversation_authority` + tuple de claim em `inbound_events` | policy V2 e preflight da outbox/sender |
| Kill switch de outbound live | singleton `conversation_runtime_control` | `ConversationRuntimeControlStore` |
| Permissão tenant-scoped de automação live | `organizations.live_automation_enabled` | policy V2, outbox e sender |
| Campanha de reativação | `reactivation_campaigns` + targets | serviços de reativação |
| Tempo local | `ClinicTimezone` | nunca offset manual |
| Comportamento universal da IA | `src/application/conversation-v2/` e core V2 | Understanding e verbalização V2 |

## Regras por categoria

### Conteúdo editorial

Tom, política comercial, objeções e identidade verbal vivem na versão ativa do playbook. Publicação é atômica e há no máximo uma versão ativa por organização.

Não coloque preço, sequência de mídia ou trigger de pipeline em `notes`; esses dados possuem campos estruturados próprios.

### Configuração operacional

Tudo que varia por organização fica no banco: timezone, horário, limites, canal, agenda, políticas, plano, status e nomenclatura do segmento. Variáveis de ambiente são reservadas a infraestrutura compartilhada e segredos da plataforma.

### Capability

Ativação por plano/tenant vive em `clinic_modules`. O delivery não deve decidir qual conteúdo enviar com base em flags; conteúdo é resolvido antes e delivery apenas executa.

### Catálogo e pipeline

Nome, aliases, duração, preço, exigência de avaliação, mídia e `pipelineSteps` pertencem ao serviço/tratamento. Regra que varia por serviço não deve ser duplicada no prompt nem em condicionais ad hoc; capabilities e Decision V2 consomem esse dono canônico.

### Agenda

- disponibilidade passa por `SlotEngine`/`CalendarGateway`;
- criação, cancelamento e reagendamento passam por `BookingService`;
- fuso passa por `ClinicTimezone`;
- UI e LLM nunca inventam slot.

### Mensageria

- payload recebido pertence a `inbound_events`;
- retry, lease e DLQ pertencem a `jobs`;
- conteúdo final e ordem pertencem a `outbound_messages`;
- histórico humano pertence a `messages`;
- retry de entrega não recomputa a conversa.

### Runtime conversacional

A V2 é o único runtime produtivo. `organizations.conversation_engine`, approvals Internal Lab e
artefatos de comparação não selecionam engine nem autorizam atendimento. Automação live exige
authority version 2, `live_automation_enabled=true`, configuração operacional elegível e kill switch global aberto. A mesma
authority exata é revalidada na criação da outbox e no sender.

Tenant pausado, desabilitado, demo, prospect ou sem authority V2 permanece inalterado por deploy.
Ativação altera status e permissão live somente na linha exata, com validação e compare-and-set; nunca é inferida de
`is_test`, build, playbook ou canal.

### LLM

O LLM pode classificar, transcrever, verbalizar e sugerir. Não é dono de tenant, auth, disponibilidade, booking, handoff final, retry, opt-out ou limites.

Understanding e verbalização V2 consomem a mesma janela canônica de histórico resolvida para o turno; nenhuma etapa mantém uma janela paralela ou seleciona a V1.

## Checklist para regra nova

1. Varia por organização, módulo ou serviço?
2. É conteúdo editorial ou regra operacional?
3. Já existe um dono na tabela acima?
4. A UI está apenas exibindo/chamando ou passou a decidir negócio?
5. O mesmo fato aparece em código e prompt?
6. Há teste determinístico para a decisão?

Resposta “sim” ao item 5 exige remodelar antes do merge.
