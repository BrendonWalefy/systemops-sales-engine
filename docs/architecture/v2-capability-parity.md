# Matriz executável de paridade de capacidades V2

Status: roadmap do produto em 2026-09-01. A V1 é referência histórica, nunca runtime ou fallback.
Arquitetura: [Expansão das capacidades de negócio no runtime V2](v2-business-capability-architecture.md).

## Contrato executável do runtime live

Esta classificação é ordenada e completa por contrato. Nenhum comportamento pode resolver para
V1; a roadmap detalhada abaixo apenas decompõe a evolução interna de cada fronteira.

| Behavior | Resolution | Current owner and safe boundary |
| --- | --- | --- |
| `opening_reception` | `v2_capability` | Dental reception/catalog capability produces an authorized response plan. |
| `catalog` | `v2_capability` | Dental catalog capability reads only the claimed tenant catalog. |
| `authorized_price` | `v2_capability` | Catalog facts disclose only explicitly quotable prices. |
| `objections` | `safe_handoff` | No deterministic V2 objection capability exists yet; unsupported cases end in explicit human attention. |
| `multi_turn_pipeline` | `shared_service` | Deterministic guided-pipeline state and operator-selected content remain shared; interpretation-dependent continuation durably pauses for human attention without V1 replay. |
| `media` | `shared_service` | Canonical ingress/history persists media independently of runtime selection; unsupported interpretation creates no inferred effect or V1 call. |
| `qualification` | `obsolete` | V2 does not infer and persist lead qualification as a side effect of model text; deterministic capabilities own explicit business effects. |
| `scheduling_revalidation` | `v2_capability` | Dental scheduling capability uses BookingService and tenant-scoped calendar reads. |
| `reservation` | `shared_service` | SlotReservationService and BookingService own reservation and double-booking safety. |
| `deposit` | `shared_service` | Existing deterministic reservation, proof review and operator decision services own deposit effects; no V1 runtime selection is involved. |
| `cancel_reschedule` | `safe_handoff` | Unscoped calendar mutations are rejected; a tenant-scoped V2 capability is required. |
| `opt_out` | `shared_service` | Deterministic stop-contact policy persists consent and creates at most one confirmation. |
| `handoff` | `v2_capability` | Dental escalation capability returns a human-action-required result. |
| `takeover` | `shared_service` | Live turn configuration suppresses active takeover and resumes only an expired lease. |
| `turn_follow_up` | `shared_service` | Existing durable follow-up service remains outside engine selection and tenant-scoped. |
| `voice` | `shared_service` | Voice module configuration is resolved by the claimed clinic ID; sender owns delivery format. |

## Legenda

- `green`: comportamento V2 produtivo e coberto pelo contrato atual;
- `shared`: serviço determinístico já existe, mas precisa ser ligado ao fluxo V2 quando indicado;
- `slice`: fatia V2 ainda necessária;
- `handoff`: saída segura atual até a fatia correspondente ficar pronta;
- `obsolete`: comportamento V1 que não será reproduzido.

## Matriz

| Domínio | Comportamento de negócio | Estado | Dono canônico / UI existente | Entrega V2 |
| --- | --- | --- | --- | --- |
| Recepção | Saudação e abertura | `green` | Playbook/Geral | `dental-reception` |
| Recepção | Reconhecimento e despedida | `green` | Comportamento universal V2 | `dental-reception` sem efeito |
| Conhecimento | Descrição de tratamento | `green` | Tratamentos | `dental-explanation` |
| Conhecimento | Comparação, diferenciais e FAQ | `green` | Playbook/Conhecimento + Tratamentos | `dental-explanation` + `dental-playbook-knowledge` |
| Conhecimento | Endereço, horário e localização | `green` | Perfil | `dental-knowledge` |
| Conhecimento | Estacionamento e redes | `green` | Conhecimento/Organização | `dental-knowledge` estruturado |
| Conhecimento | Dúvidas gerais cadastradas | `green` | Playbook/Conhecimento | FAQ estruturada com evidência |
| Comercial | Preço explicitamente divulgável | `green` | Tratamentos | `dental-catalog` |
| Comercial | Campanha de preço vigente | `shared` | Tratamentos/Campanhas | resolver campanha antes do plano |
| Comercial | Pagamento e parcelamento | `slice` | Playbook/Financeiro | política comercial estruturada |
| Comercial | Quantidade/escopo antes de preço | `slice` | Tratamentos + pipeline | esclarecimento determinístico |
| Comercial | Objeção de preço/condição | `handoff` | Playbook/Financeiro | capability de objeções |
| Comercial | Preço antigo ou informação inconsistente | `slice` | Campanhas + política comercial | correção com provenance |
| Jornada | Iniciar e avançar `pipelineSteps` | `shared` | Pipeline | capability de jornada |
| Jornada | Pergunta estruturada de um passo | `shared` | Pipeline | decisão de próximo passo |
| Jornada | Conteúdo, foto e vídeo cadastrados | `shared` | Pipeline + Biblioteca | mídia allowlisted |
| Jornada | Receber foto/áudio/documento | `shared` | Inbox + estado | roteamento por tipo e etapa |
| Jornada | Continuação após vídeo | `shared` | Pipeline | automação deduplicada |
| Sinal | Criar reserva e instruções Pix | `shared` | Financeiro + Agenda | capability de sinal |
| Sinal | Receber comprovante | `shared` | Inbox/DepositBanner | estado + revisão humana |
| Sinal | Aprovar/rejeitar/expirar sinal | `shared` | Inbox/DepositBanner | serviço determinístico existente |
| Agenda | Buscar e oferecer horários | `green` | Agenda + Profissionais | `dental-scheduling` |
| Agenda | Rejeitar oferta e buscar alternativas | `slice` | Agenda | scheduling lifecycle |
| Agenda | Slot expirado/tomado e nova oferta | `slice` | Agenda | revalidação + reoferta |
| Agenda | Criar e confirmar consulta | `green` | Agenda | `BookingService` |
| Agenda | Listar consultas | `slice` | Agenda | read port tenant-scoped |
| Agenda | Cancelar consulta | `handoff` | Agenda | write port tenant-scoped |
| Agenda | Reagendar consulta | `handoff` | Agenda | cancel/rebook coordenado |
| Agenda | Tratamento exige avaliação | `slice` | Tratamentos + Agenda | redirecionamento autorizado |
| Operação | Pedido explícito de humano | `green` | Inbox | `dental-escalation` |
| Operação | Takeover/pausa da IA | `shared` | Inbox | live turn gate existente |
| Operação | Urgência clínica sem diagnóstico | `handoff` | Inbox | classificação fechada + handoff |
| Operação | Problema em trabalho existente | `handoff` | Inbox | rota operacional fechada |
| Operação | Paciente chegou ou está atrasado | `slice` | Agenda + Inbox | evento operacional idempotente |
| Consentimento | Opt-out e confirmação única | `shared` | Inbox/configuração | policy + sender safety existentes |
| Relacionamento | Follow-up e recuperação | `shared` | Inbox/configuração | produtor V2 de plano/outbox |
| Relacionamento | Lembrete e confirmação de consulta | `shared` | Agenda | produtor V2 de plano/outbox |
| Relacionamento | Pós-atendimento | `shared` | Agenda/configuração | regras existentes + V2 outbound |
| Relacionamento | Campanhas | `shared` | Campanhas | audiência/oferta existentes + V2 outbound |
| Canal | Voz | `shared` | Playbook/Voz | sender mantém formato de entrega |
| Legado | Qualificação inferida por texto do modelo | `obsolete` | — | somente efeitos explícitos e determinísticos |

### Evidência da fatia institucional

`business-information` usa um tópico fechado e `dental-knowledge` produz somente `answer` ou
`ask`. Endereço vem de `organizations.address` e `addressComplement`; horário vem de
`businessHours`; orientação usa `locationMessage` e, quando ausente, o endereço; estacionamento usa
`parkingInformation`; redes usam a lista estruturada `socialChannels`. O adapter está
fechado sobre a organização reivindicada e usa o snapshot já carregado, portanto acrescenta zero
query, zero lock e zero efeito de negócio. O turno mantém uma chamada de Understanding, no máximo
uma verbalização e a cardinalidade normal de uma única resposta/outbox.

Dado ausente gera uma resposta específica para o tópico, informando honestamente que ele não está
cadastrado. Dado presente que esteja não normalizado, contenha caracteres de controle ou exceda
240 caracteres falha fechado da mesma forma; complemento ou orientação inválida não é ocultado por
fallback parcial. `mapsUrl` não é exposta. Links sociais só são verbalizados quando o valor
estruturado completo aparece na superfície autorizada; um segundo link continua proibido. Nenhum
texto editorial livre é minerado para preencher lacunas.

O gate PostgreSQL executa endereço presente/ausente, estacionamento e redes por ingress, claim de
processamento, handler, outbox, claim de envio e sender. Todos mantêm cardinalidade `1/1/1/1/1`, duas chamadas de
modelo no máximo (Understanding + verbalização), nenhuma mutação de agenda/reserva/estado e nenhum
aumento de statements. Round trips sequenciais admitem a tolerância de duas ondas causada pela
sobreposição temporal do medidor, e lock hold permanece dentro da tolerância contra uma resposta
comum.

Os movimentos `acknowledges` e `closes` produzem, respectivamente, `social_acknowledged` e
`conversation_closed`. São atos sociais fechados, sem facts ou efeitos: agradecimento não recebe
uma nova pergunta e despedida não reabre a jornada.

### Evidência da fatia de tratamentos e playbook

`compare-services` exige exatamente dois nomes canônicos distintos. `dental-explanation` resolve os
dois no mesmo catálogo tenant-scoped e emite uma descrição autorizada e uma evidência por
tratamento; ausência, ambiguidade, duplicidade ou descrição insegura produz esclarecimento. O
resultado multi-subject mantém cada fato ligado ao próprio tratamento sem criar um subject global
falso.

`business-differentials` e `frequently-asked-question` pertencem a
`dental-playbook-knowledge`. A capability lê somente o snapshot da versão ativa já carregado no
turno. Diferenciais permanecem na ordem cadastrada; FAQ seleciona uma pergunta canônica por
igualdade normalizada e expõe somente a resposta correspondente. Evidence refs contêm versão e
posição, nunca o conteúdo. Understanding recebe nomes de tratamentos e perguntas de FAQ limitadas,
mas nunca recebe respostas. A execução mantém uma chamada de Understanding, no máximo uma
verbalização, zero efeitos de negócio, zero query adicional para playbook e uma única
resposta/outbox.

## Ordem de implementação

1. conhecimento institucional básico concluído;
2. estacionamento, redes, recepção social, comparação, diferenciais e FAQ concluídos;
3. comercial, campanhas e objeções são a próxima fatia;
4. ciclo completo da agenda;
5. jornada, mídia e sinal;
6. operação clínica, handoff e automações;
7. diagnóstico read-only do trace no Inbox e corpus final de paridade;
8. auditoria final e remoção futura dos roots históricos V1.

A ordem prioriza respostas frequentes e prova primeiro o caminho de baixo risco. O pipeline já
existente fornece os contratos comuns; não haverá uma fase de criação de aliases, roteador ou
guardas genéricas. Uma linha só muda para `green` após replay ponta a ponta, isolamento por tenant,
idempotência, trace completo e resposta validada.

## Contrato da UI

Antes de criar campo, tabela ou tela, a fatia deve provar que o dado não existe em uma destas
superfícies:

| Superfície | Dados de negócio que já possui |
| --- | --- |
| Playbook/Geral e Conhecimento | tom, identidade, informação institucional, FAQ e política editorial |
| Playbook/Financeiro | política comercial, pagamento, parcelamento e sinal |
| Playbook/Agenda | regras operacionais da agenda |
| Tratamentos | catálogo, aliases, descrição, preço e requisitos |
| Pipeline | sequência de conteúdo, perguntas, mídia, foto e agenda |
| Biblioteca | ativos de mídia autorizados |
| Profissionais | profissionais e vínculos de calendário |
| Agenda | compromissos, bloqueios e operação manual |
| Inbox | takeover, handoff, comprovante e histórico da conversa |
| Campanhas | oferta, audiência, prazo e revisão |

O adapter V2 lê o mesmo registro que a UI grava. A UI não recebe campos técnicos como
`capabilityId`, `Decision`, `ActionResult`, authority ou claim token.

## Definition of done por linha

- request e entidades em schema fechado;
- capability, Decision e ActionResult com provenance pareada;
- leitura e efeito pelo dono canônico, sem SQL espalhado no handler;
- uso da configuração editada pela UI existente;
- fatos da resposta ligados a evidence refs e validator;
- trace completo do understanding à entrega ou estado terminal;
- testes RED/GREEN de sucesso, ambiguidade, falha, retry, dedupe e isolamento;
- replay de casos históricos sanitizados sem executar V1;
- uma chamada de Understanding e no máximo uma verbalização;
- nenhuma ativação automática de tenant;
- `npm run verify`, build e CI verdes no commit limpo.
