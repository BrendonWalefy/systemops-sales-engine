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
| `authorized_price` | `v2_capability` | `dental-commercial` resolves current treatment/campaign authority and discloses only explicitly quotable prices. |
| `objections` | `v2_capability` | Exact active-playbook objections are answered with versioned evidence; unresolved free objections end in explicit human attention. |
| `multi_turn_pipeline` | `v2_capability` | `dental-journey` resolves configured steps; the state machine and sender commit the exact revision only after delivery. |
| `media` | `v2_capability` | Trusted media metadata routes expected journey photos and deposit proofs without model inference; configured media remains tenant-scoped and allowlisted. |
| `qualification` | `obsolete` | V2 does not infer and persist lead qualification as a side effect of model text; deterministic capabilities own explicit business effects. |
| `scheduling_revalidation` | `v2_capability` | Dental scheduling capability uses BookingService and tenant-scoped calendar reads. |
| `reservation` | `shared_service` | SlotReservationService and BookingService own reservation and double-booking safety. |
| `deposit` | `v2_capability` | `dental-scheduling` creates the exact hold and `dental-journey` receives proof; existing deterministic review and booking services retain final authority. |
| `cancel_reschedule` | `v2_capability` | `dental-appointment-lifecycle` selects the exact tenant-bound appointment; `BookingService` owns cancellation and compensated rescheduling. |
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
| Comercial | Preço explicitamente divulgável | `green` | Tratamentos | `dental-commercial` |
| Comercial | Campanha de preço vigente | `green` | Tratamentos/Campanhas | preço efetivo com evidência da campanha |
| Comercial | Pagamento e parcelamento | `green` | Playbook/Financeiro | métodos estruturados e cálculo determinístico |
| Comercial | Quantidade/escopo antes de preço | `green` | Tratamentos | somente pacotes exatos cadastrados |
| Comercial | Objeção de preço/condição | `green` | Playbook/Financeiro | resposta exata cadastrada ou handoff |
| Comercial | Preço antigo ou informação inconsistente | `green` | Campanhas + Tratamentos | valor atual com provenance, sem confiar no valor citado |
| Jornada | Iniciar e avançar `pipelineSteps` | `green` | Pipeline | `dental-journey` + CAS pós-entrega |
| Jornada | Pergunta estruturada de um passo | `green` | Pipeline | decisão fechada pelo passo atual |
| Jornada | Conteúdo, foto e vídeo cadastrados | `green` | Pipeline + Biblioteca | ordem configurada e mídia allowlisted |
| Jornada | Receber foto/áudio/documento | `green` | Inbox + estado | imagem/vídeo esperado ou comprovante imagem/documento; demais tipos falham fechados |
| Jornada | Continuação após vídeo | `green` | Pipeline | avanço exato e idempotente após entrega completa |
| Sinal | Criar reserva e instruções Pix | `green` | Financeiro + Agenda | reserva exata e template determinístico |
| Sinal | Receber comprovante | `green` | Inbox/DepositBanner | estado exato + revisão humana + atenção pós-entrega |
| Sinal | Aprovar/rejeitar/expirar sinal | `green` | Inbox/DepositBanner | serviços determinísticos existentes preservados |
| Agenda | Buscar e oferecer horários | `green` | Agenda + Profissionais | `dental-scheduling` |
| Agenda | Rejeitar oferta e buscar alternativas | `green` | Agenda | nova busca tenant-scoped e oferta persistida |
| Agenda | Slot expirado/tomado e nova oferta | `green` | Agenda | revalidação antes do efeito e nova oferta segura |
| Agenda | Criar e confirmar consulta | `green` | Agenda | `BookingService` |
| Agenda | Listar consultas | `green` | Agenda | `dental-appointment-lifecycle` tenant-scoped |
| Agenda | Cancelar consulta | `green` | Agenda | cancelamento idempotente do compromisso exato |
| Agenda | Reagendar consulta | `green` | Agenda | atualização do mesmo compromisso com compensação |
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

### Evidência da fatia comercial

`dental-commercial` é o único dono de preço, campanha, pacote por quantidade, pagamento,
parcelamento e objeção cadastrada. O preço de lista e os pacotes continuam em `treatments`; uma
campanha ativa em `price_campaigns` é o único override; métodos e taxas vêm da aba Financeiro da
organização; respostas de objeção vêm da versão ativa do playbook. `commercialPolicy` permanece
editorial e nunca é minerada para autorizar número, método ou condição.

Understanding copia somente serviço, quantidade/escopo e a pergunta canônica da objeção. Ele não
recebe preço, taxa, método nem resposta. A capability resolve o tenant já reivindicado e autoriza
cada valor na superfície: campanha vencida não substitui preço; quantidade não cadastrada nunca é
extrapolada; parcela usa a taxa flat registrada; objeção sem correspondência exata vai para humano.
Um valor antigo citado pelo lead não é uma autoridade e a resposta contém apenas o valor efetivo
persistido.

O gate PostgreSQL atravessa ingress, claim, handler, outbox, claim de envio e sender para campanha,
pacote, pagamento, parcela e objeção. Cada caso mantém cardinalidade `1/1/1/1/1`, uma chamada de
Understanding, no máximo uma verbalização, zero mutações de agenda/reserva/estado e no máximo uma
query indexada adicional para campanha. Nenhum tenant é ativado ou preenchido por essa entrega.

### Evidência da fatia de agenda

`dental-appointment-lifecycle` lista e seleciona somente compromissos ativos do lead dentro do
tenant reivindicado, em ordem determinística. Cancelamento usa compare-and-set no compromisso
exato. Reagendamento persiste a autoridade da oferta substituta e atualiza o mesmo compromisso:
reserva e revalida o alvo, atualiza o calendário, grava o novo intervalo e compensa o calendário
se a gravação local falhar. Falha de compensação termina em handoff explícito, nunca em sucesso.

Preferência profissional resolve somente profissionais ativos do tenant e fica persistida na
oferta e no compromisso. O modelo recebe rótulos canônicos, nunca IDs ou disponibilidade. Cada
statement enviado ao verbalizador preserva o outcome fechado (`appointments_listed`,
`appointment_cancelled`, `appointment_rescheduled` ou falha), evitando que listar, cancelar e
reagendar percam sua semântica na fronteira de linguagem. Retry exato não cria outro compromisso,
efeito ou resposta.

### Evidência da fatia de jornada, mídia e sinal

`dental-journey` resolve somente o tratamento canônico do tenant e consome
`treatments.pipelineSteps` na ordem cadastrada. Texto vem do bloco de conteúdo; imagem e vídeo vêm
de `media_assets` carregados em uma única leitura tenant-scoped. O plano do turno é persistido em
uma única outbox `live_stream_reply`; o sender avança a revisão exata do pipeline somente depois
que todas as partes foram entregues. Retry do sender não recompõe conteúdo e o compare-and-set
impede avanço duplo.

Imagem ou vídeo só vira foto de jornada quando o estado atual exige exatamente esse passo. A foto
cria ou reutiliza a revisão humana vinculada à conversa, lead e tratamento; somente após a
confirmação enviada ao lead o Inbox entra em handoff. Imagem ou documento só vira comprovante
quando o estado é `awaiting_deposit_proof` e a reserva ainda corresponde ao tenant, lead e
intervalo persistidos. O recebimento grava o ID da mensagem canônica, mantém a decisão financeira
exclusivamente humana, estende o hold pelo `depositTtlHours` do tenant e marca atenção somente após
a confirmação ser entregue.

Ao selecionar um slot com sinal habilitado, `dental-scheduling` reserva o intervalo exato, persiste
o snapshot imutável de tratamento/valor e usa o template Pix determinístico; nenhuma chave ou
valor passa pelo verbalizador. Sinal desabilitado preserva o booking direto. Configuração
incompleta, reserva divergente, state race ou tenant divergente falha fechada, sem agendamento ou
outbound parcial. Um pedido de troca antes do comprovante libera o hold exato; depois do
comprovante exige decisão humana.

Os gates cobrem uma única resposta/job por turno, zero chamada de Understanding para mídia
estruturada, no máximo uma chamada para texto, zero verbalização para conteúdo/Pix/comprovante
determinísticos, transições PostgreSQL idempotentes e ausência de V1, polling ou ativação de
tenant.

## Ordem de implementação

1. conhecimento institucional básico concluído;
2. estacionamento, redes, recepção social, comparação, diferenciais e FAQ concluídos;
3. comercial, campanhas e objeções concluídos;
4. ciclo completo da agenda concluído;
5. jornada, mídia e sinal concluídos;
6. operação clínica, handoff e automações são a próxima fatia;
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
