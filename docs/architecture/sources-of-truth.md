# Fontes de verdade

Atualizado em 2026-08-06.

> Se um fato precisa ser alterado em mais de um lugar, o ownership está errado.

## Mapa de donos

| Categoria | Dono canônico | Acesso principal |
| --- | --- | --- |
| Tenant e operação | `organizations` | entidade `Clinic`/repositório, enquanto a nomenclatura interna é compatível |
| Capabilities e voz | `clinic_modules` | `module-gate` e resolver de voz |
| Conteúdo editorial | `playbook_versions` ativo | `resolveActiveEditorialConfig(clinicId)` |
| Serviço e jornada | `treatments` + `pipelineSteps` | repositório de tratamentos e orquestrador |
| Ofertas | `price_campaigns` | `resolveEffectivePrice` |
| Agenda | `appointments`, `calendar_blocks`, `slot_reservations` | `BookingService` + `CalendarGateway` |
| Conversa | `leads`, `conversations`, `messages`, `conversation_states` | use cases e state machine |
| Evento recebido | `inbound_events` | inbound event store |
| Trabalho pendente | `jobs` | job queue |
| Intenção de envio | `outbound_messages` | outbound message store |
| Campanha de reativação | `reactivation_campaigns` + targets | serviços de reativação |
| Tempo local | `ClinicTimezone` | nunca offset manual |
| Comportamento universal da IA | `src/core/intelligence/` | classifier/composer/advisor |

## Regras por categoria

### Conteúdo editorial

Tom, política comercial, objeções e identidade verbal vivem na versão ativa do playbook. Publicação é atômica e há no máximo uma versão ativa por organização.

Não coloque preço, sequência de mídia ou trigger de pipeline em `notes`; esses dados possuem campos estruturados próprios.

### Configuração operacional

Tudo que varia por organização fica no banco: timezone, horário, limites, canal, agenda, políticas, plano, status e nomenclatura do segmento. Variáveis de ambiente são reservadas a infraestrutura compartilhada e segredos da plataforma.

### Capability

Ativação por plano/tenant vive em `clinic_modules`. O delivery não deve decidir qual conteúdo enviar com base em flags; conteúdo é resolvido antes e delivery apenas executa.

### Catálogo e pipeline

Nome, aliases, duração, preço, exigência de avaliação, mídia e `pipelineSteps` pertencem ao serviço/tratamento. Regra que varia por serviço não deve ser duplicada no prompt ou em condicionais do orquestrador.

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

### LLM

O LLM pode classificar, transcrever, verbalizar e sugerir. Não é dono de tenant, auth, disponibilidade, booking, handoff final, retry, opt-out ou limites.

Classifier e composer usam a mesma janela de histórico por meio de `takeRecentConversationHistory()` e `aiContextWindowMessages`.

## Checklist para regra nova

1. Varia por organização, módulo ou serviço?
2. É conteúdo editorial ou regra operacional?
3. Já existe um dono na tabela acima?
4. A UI está apenas exibindo/chamando ou passou a decidir negócio?
5. O mesmo fato aparece em código e prompt?
6. Há teste determinístico para a decisão?

Resposta “sim” ao item 5 exige remodelar antes do merge.
