# Features atuais

Atualizado em 2026-08-06. Este catálogo descreve apenas capacidades existentes no código atual.

## Jornada do lead

| Capacidade | O que entrega | Principais donos |
| --- | --- | --- |
| Especialista comercial com IA | Entende texto, áudio e mídia; qualifica, mantém contexto e conduz a jornada conforme estratégia, playbook e catálogo | `ConversationOrchestrator`, `IntentClassifier`, `ResponseComposer` |
| Pipeline por serviço | Executa conteúdo, vídeo, Q&A, coleta de foto e oferta de agenda | `treatments.pipelineSteps`, `PipelineMediaRouter` |
| Agenda | Oferece slots, agenda, cancela e remarca com proteção contra conflito | `BookingService`, `SlotReservationService`, `CalendarGateway` |
| Handoff | Pausa a IA e entrega contexto para a equipe em casos sensíveis ou falhas | `ConversationStateMachine`, Inbox, Web Push |
| Follow-up | Reengaja leads elegíveis sem recomputar o turno original | `follow_ups`, outbox, sender worker |
| Recuperação | Identifica oportunidades, gera mensagens e executa réguas automáticas | `lead_outcomes`, campanhas e crons |
| Lembretes | Envia D-1, avisos à equipe e pós-atendimento configurável | crons, `appointments`, outbox |
| Sinal | Reserva provisória, solicita comprovante e exige validação humana | regras de depósito e `appointments` |

## Operação da organização

| Superfície | Informações e ações |
| --- | --- |
| Home | KPIs, funil, fluxo de leads, agenda, receita, alertas e filas acionáveis |
| Inbox | Conversas ativas, atenção humana, pausadas, histórico e recuperação |
| Agenda | Compromissos, bloqueios, profissionais e integração opcional com Google Calendar |
| Campanhas | Audiência, oferta, rascunhos, revisão, aprovação, ensaio, dispatch e resultados |
| Pipeline | Configuração declarativa da jornada por tratamento/serviço |
| Playbook | Conteúdo editorial versionado, lint, simulador e sugestões assistidas por IA |
| Biblioteca | Upload e gestão de mídia usada nas respostas e pipelines |
| Equipe | Usuários, papéis e permissões por organização |

## Operação do owner

- criação e onboarding de organizações;
- blueprint de prontidão e módulos contratados;
- pareamento e provisionamento do canal;
- status operacional, ativação, pausa, arquivamento e purge;
- qualidade da IA, custos, margem e insights;
- saúde de canal, alertas operacionais e digest;
- inspeção e tratamento auditado de dead letters;
- estudos de setup e revisão pública tokenizada de conversas sanitizadas.

## Fontes da Home

```text
organizations + memberships
leads + conversations + messages
appointments + treatments + price_campaigns
channel_health_snapshots + clinic_metrics
  -> queries server-side tenant-scoped
  -> cálculos determinísticos de período e funil
  -> DashboardCommandCenter
```

- O funil deriva de estados persistidos de leads e conversas, não de uma resposta do LLM.
- Receita potencial usa preço efetivo do serviço/oferta e agendamentos do período.
- A agenda usa `appointments`, `calendar_blocks` e profissionais.
- Saúde do canal usa snapshots e alertas, sem ler credenciais no browser.
- Valores financeiros respeitam o papel autenticado.

## Campanhas

Existem dois conceitos distintos:

1. `price_campaigns`: oferta/preço vigente de um serviço, consumida pela conversa, Home e booking.
2. `reactivation_campaigns`: operação de reengajamento com audiência congelada, targets, rascunhos, revisão humana e dispatch.

Fluxo de reativação:

```text
segmentação -> preview -> campanha + targets -> rascunhos por IA
-> revisão humana -> aprovação -> outbox -> safety gate -> WhatsApp
-> resposta/conversão volta pelo webhook
```

O sender revalida opt-out, destino, quiet hours, limites, warm-up e obsolescência imediatamente antes da entrega.

## Limites conhecidos

- Z-API é o canal principal; Meta Cloud API permanece como alternativa compatível.
- Mídia inbound recente depende do ciclo de vida da URL do provedor.
- PostgreSQL acumula banco transacional e fila; a separação será feita apenas quando os gatilhos operacionais forem atingidos.
- O domínio técnico usa `organizations`, mas alguns nomes de aplicação ainda preservam `clinicId` por compatibilidade.
- Agenda é uma capability central hoje; expansão para segmentos sem agenda exige modularização adicional.
