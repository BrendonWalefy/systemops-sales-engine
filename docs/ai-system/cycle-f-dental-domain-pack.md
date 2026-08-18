# Ciclo F — Dental Domain Pack

O pack dental prova a conexão de um domínio real ao Conversation Core V2 sem alterar
`src/conversation-core/**`. O recorte é deliberadamente mínimo: preço com serviço identificado,
disponibilidade de serviço, pedido de agendamento e confirmações pendentes.

## Representação do domínio

- `vocabulary.ts`: cinco requests e cinco conceitos; nomes e aliases de serviços entram como
  catálogo estruturado do tenant, não como constantes de clínica.
- `understanding.ts` e `understanding-prompt.ts`: validam `understanding.v1` e fazem a ponte de
  linguagem para conceitos dentais. Linguagem fica no adapter de infraestrutura.
- `structured-input.ts`: preserva somente `/reset`, seleção fechada de menu e opção previamente
  oferecida. Não interpreta linguagem natural.
- `capabilities.ts`: no fechamento do F eram três stubs de contrato. O Ciclo G os substituiu por
  factories com ports read/write separados e ActionResults lastreados.
- `index.ts`: registra ordem e jornadas no contrato genérico `DomainPack`.

## Corpus e limites da medição

O manifesto congela 17 de 51 casos dentais: 11 de preço e 6 de
disponibilidade/agendamento/confirmação. Os 34 restantes são `skipped`, com requests excluídos e
razão escrita. O runner aceita observações V2 e reporta cada eixo separadamente; ele não chama a
V1. Nenhuma rodada de modelo foi executada no fechamento do F, portanto não existe baseline
comportamental nova nem porcentagem artificial. Os testes medem contrato e representabilidade,
não qualidade probabilística de um modelo.

## Cicatrizes do Ciclo D

| Necessidade observada                                 | Classificação no F                  | Destino                                                 |
| ----------------------------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `isPriceRequestText`                                  | responsabilidade do pack            | request `price-of-service`; nenhuma keyword foi portada |
| `isSchedulingRequestText`                             | responsabilidade do pack            | requests distintos de disponibilidade e agendamento     |
| `detectAppointmentConfirmation`                       | absorvida por Understanding + state | `confirm-appointment` e estado estruturado              |
| `messageOffersConcreteSlot` / pending offer           | absorvida por state                 | opção oferecida é dado estruturado, não texto do agente |
| `isResetCommand`, menu e re-request                   | absorvida como feature estrutural   | matching exato e conjunto fechado                       |
| manutenção, sábado, catálogo e horário                | futura capability do G              | exigem policy, fatos e authorized reads reais           |
| regex/keywords que reclassificam as jornadas cobertas | obsoleta na V2                      | não portar; V1 segue congelada                          |
| scars fora das jornadas suportadas                    | ainda não explicada no F            | reavaliar pelo corpus ao abrir cada capability futura   |

Esta classificação não equivale a uma nova tabela de regras. Ela aponta o contrato que absorve a
necessidade e mantém os 35 predicados da V1 intocados.

## Representável, decidível e executável

| Jornada                         | Representável | Decidível no F |                                    Executável no F |
| ------------------------------- | ------------: | -------------: | -------------------------------------------------: |
| preço com serviço               |           sim |            sim | sim, contra port injetado; runtime ainda desligado |
| disponibilidade de serviço      |           sim |            sim |                         sim, como read de catálogo |
| pedido de agendamento           |           sim |            sim |                oferece slots lastreados, sem write |
| confirmação de slot/agendamento |           sim |            sim |                    sim, contra write port injetado |
| escalada por safety estruturada |           sim |            sim |     produz escalada; handoff externo não é alegado |

## Gaps do F resolvidos no G

- authorized reads pertencem às capabilities via ports pré-escopados injetados;
- claim ganhou payload genérico tipado, concretizado no pack como união discriminada, e facts
  ganharam subject/evidence/disclosure;
- catálogo, preço, slots e confirmações possuem decisões e ActionResults reais contra ports;
- o pipeline decide tudo antes do primeiro efeito.

Adapters concretos, composition root produtivo e novas jornadas continuam deliberadamente fora.

Composer produtivo, V1×V2, shadow e cutover continuam reservados aos Ciclos H/I.
