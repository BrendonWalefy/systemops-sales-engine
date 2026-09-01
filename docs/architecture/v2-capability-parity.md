# Matriz executável de paridade de capacidades V2

Status: roadmap do produto em 2026-08-31. A V1 é referência histórica, nunca runtime ou fallback.
Arquitetura: [Expansão das capacidades de negócio no runtime V2](v2-business-capability-architecture.md).

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
| Recepção | Reconhecimento e despedida | `slice` | Playbook/Geral | recepção social sem efeito |
| Conhecimento | Descrição de tratamento | `green` | Tratamentos | `dental-explanation` |
| Conhecimento | Comparação, diferenciais e FAQ | `slice` | Playbook/Conhecimento + Tratamentos | conhecimento com evidência |
| Conhecimento | Endereço, horário e localização | `slice` | Perfil + Playbook/Geral | informação institucional |
| Conhecimento | Estacionamento, redes e dúvidas gerais | `slice` | Playbook/Conhecimento | informação institucional |
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

## Ordem de implementação

1. conhecimento institucional como prova do caminho de leitura;
2. conhecimento restante e recepção social;
3. comercial e objeções;
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
