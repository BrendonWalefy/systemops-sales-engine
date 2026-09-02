# Operação clínica no runtime V2

Status: aprovado como a sexta fatia da matriz de paridade V2. A V1 é somente referência
histórica e não participa de decisão, fallback ou execução.

## Objetivo

Levar ao runtime V2 os turnos operacionais que hoje terminam em uma resposta genérica ou não têm
uma representação fechada: tratamento que exige avaliação, urgência clínica, problema em trabalho
existente e aviso de chegada ou atraso. A IA identifica a natureza do pedido e verbaliza somente o
resultado autorizado; código determinístico decide leitura, efeito, handoff e autorização de envio.

Automações iniciadas pela clínica — lembretes, follow-up, recuperação, pós-atendimento e campanhas
— permanecem uma entrega vertical separada. Elas não compartilham o claim de um turno inbound e
não devem ser acopladas a esta capability.

## Fronteiras e donos

| Responsabilidade | Dono |
| --- | --- |
| Interpretar o pedido e copiar entidades fechadas | `DentalUnderstandingProvider` |
| Decidir a operação permitida | `dental-operations` |
| Resolver tratamento e compromisso dentro do tenant reivindicado | adapters de leitura V2 |
| Marcar conversa para atendimento humano | `V2ConversationHandoffStore` |
| Formatar a resposta sem inventar diagnóstico ou estado | response plan + verbalizer validado |
| Autorizar, deduplicar e entregar | outbox `live_stream_reply` + sender V2 |
| Exibir atenção e compromisso existente | Inbox e Agenda já existentes |

Nenhuma tabela ou tela nova é necessária. O evento inbound, o decision trace, o estado de atenção
da conversa e o outbox autorizado já formam o registro auditável.

## Vocabulário fechado

O schema de Understanding passa a aceitar quatro pedidos operacionais:

- `clinical-urgency`: dor forte, sangramento, trauma ou outra urgência relatada;
- `existing-treatment-problem`: quebra, soltura ou desconforto em trabalho já realizado;
- `patient-arrival`: o paciente informa que chegou ao local;
- `patient-delay`: o paciente informa que chegará atrasado.

Pedidos de diagnóstico, prognóstico, indicação ou julgamento clínico não recebem uma conclusão do
modelo. O prompt proíbe esse conteúdo e pedidos explícitos de atendimento humano continuam sob
`dental-escalation`; `dental-operations` reivindica somente os quatro pedidos operacionais fechados.
O modelo não recebe permissão para prescrever, diagnosticar, prometer encaixe ou afirmar que a
equipe viu o aviso.

Os pedidos operacionais proíbem `serviceCandidates`, quantidade, objeção comercial e profissional.
`service` é opcional somente para `existing-treatment-problem`; data e horário são apenas pistas de
resolução de um compromisso e nunca autorizam mutação de agenda.

## Capability e fluxo

`dental-operations` tem precedência sobre catálogo, comercial, agenda e recepção. Um claim
operacional conflitante falha fechado. A capability produz um resultado `human_action_required`
com uma razão fechada:

- `clinical_urgency_requires_human`;
- `existing_treatment_problem_requires_human`;
- `patient_arrival_requires_human`;
- `patient_delay_requires_human`.

O handler traduz essa razão para um `V2ConversationHandoffReason` específico e chama o store
tenant-scoped antes de criar o outbox. A gravação é idempotente: a conversa exata fica com
`aiPaused=true`, `needsAttention=true`, lease de takeover removido e razão auditável. Entrega ou
retry do mesmo inbound continua limitada pelo tuple de authority e pelo dedupe do outbox.

Para chegada ou atraso, o read port procura compromissos ativos do lead no tenant e no dia local da
clínica. Exatamente um compromisso gera subject/evidence vinculados ao registro. Zero ou mais de um
não autorizam escolher um compromisso: o handoff ainda é criado, sem afirmar data, horário ou
confirmação. Nenhum status de compromisso é alterado por mensagem.

## Tratamento que exige avaliação

`dental-scheduling` já lê `Treatment.requiresEvaluationFirst`; a fatia deixa de converter esse dado
em esclarecimento genérico. Ela produz `clinical_evaluation_required`, vinculada ao tratamento e à
evidência do catálogo, com semântica `human_action_required`. O sistema não inventa um serviço de
avaliação, não oferece slots do tratamento bloqueado e não cria reserva. A equipe recebe o handoff
para orientar ou cadastrar explicitamente o fluxo de avaliação existente na UI.

## Resposta e rastreabilidade

O response plan contém apenas o outcome, o subject comprovado e referências opacas de evidência.
O verbalizer pode tornar a mensagem natural, mas não pode adicionar diagnóstico, tratamento,
prazo, disponibilidade ou promessa. Se a verbalização falhar no contrato, a resposta determinística
segura é enviada e a rejeição continua registrada pelo cofre de evidência já existente.

O decision trace registra request, capability, decision, outcome, razão de handoff, contagem de
chamadas de modelo, validação, outbox e entrega. Telefone, conteúdo bruto e payload do provedor não
entram no trace.

## Falhas, retries e terminalidade

- Falha antes do efeito: usa a política terminal V2 e no máximo uma confirmação segura.
- Handoff persistido e outbox falha: a conversa permanece pausada e visível; não se recompõe o
  efeito nem se cria uma segunda resposta.
- Retry do mesmo evento: reutiliza authority e dedupe, sem segundo handoff lógico ou outbound.
- Tenant, lead, conversa, compromisso ou tratamento divergente: falha fechado antes do efeito.
- Takeover, opt-out, shadow, kill switch ou authority menor que 2: os gates existentes impedem o
  fluxo e não há fallback V1.

## Performance e segurança de dados

Não há migration, polling, heartbeat ou worker novo. A resolução de compromisso reutiliza a leitura
tenant-scoped já carregada ou uma consulta indexada por tenant/lead; ela ocorre somente nos dois
pedidos de presença. Urgência e problema em trabalho existente não consultam calendário.

O gate compara com o baseline V2 atual: uma chamada de Understanding, no máximo uma verbalização,
um outbox e um job; zero mutações de agenda/reserva; nenhuma atividade de banco em idle; p95 de
turno até 25% acima do caso comum; no máximo uma query indexada adicional para chegada/atraso e
nenhum aumento de lock hold além de 20 ms.

## Critérios de aceitação

- Os quatro pedidos fechados são interpretados sem texto clínico virar regra de negócio.
- Urgência e trabalho existente nunca recebem diagnóstico ou recomendação.
- Chegada e atraso geram exatamente um handoff e no máximo uma resposta por evento.
- Um compromisso só é citado quando a resolução tenant/lead/dia é única.
- Tratamento com avaliação obrigatória não oferece slot nem reserva.
- Cross-tenant, ambiguidade, retry e falha de outbox permanecem fail-closed e auditáveis.
- Corpus histórico sanitizado, testes PostgreSQL, performance, `npm run verify`, build e CI ficam
  verdes antes de promoção.
