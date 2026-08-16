# Ciclo G — capabilities, policy e execução autorizada

Checkpoint inicial: `96ff0742` (fechamento do F).

## Arquitetura entregue

O G mantém o fluxo `Understanding → Claim → Coordinator → decide → execute → ActionResult` e
fecha quatro lacunas necessárias para operação determinística:

1. `CapabilityClaim<TPayload>` preserva um payload tipado do Domain Pack entre `claim()` e
   `decide()`; o core conhece apenas o parâmetro genérico.
2. Cada `Fact` registra subject, evidence e disclosure; o plano V2 preserva essas relações e
   recusa fatos divulgáveis sem subject.
3. O pipeline conclui todas as decisões/authorized reads antes do primeiro `execute`.
4. Capabilities concretas recebem ports pré-escopados na construção. Nenhum port entra em
   `CapabilityContext`, no coordinator ou no core.

## Ports e fases

| Capability | `claim()`                             | `decide()` — reads                                             | `execute()` — writes                     |
| ---------- | ------------------------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| Catalog    | request, serviço e state estruturados | `resolveService`                                               | nenhum; materializa resultado autorizado |
| Scheduling | request, preferência e pending step   | `listSlots`, `resolveOfferedSlot`, `resolvePendingAppointment` | `bookSlot`, `confirmAppointment`         |
| Escalation | sinais estruturados de safety         | nenhum                                                         | nenhum write externo neste recorte       |

Os ports são interfaces do pack, não adapters concretos. A composição futura cria uma instância
por tenant/lead e pode adaptá-los a catálogo, CalendarGateway e BookingService sem mudar core ou
capability. V2 não foi ligada ao runtime produtivo neste ciclo.

## Claims tipados e independência de provider

O Dental Pack define uma união discriminada `DentalClaimPayload`: Catalog, Scheduling e
Escalation têm campos explícitos para request, serviço, data, período, seleção pendente e sinais
de safety. Não há `Record<string, any>`, mapa de payload sem schema, semântica serializada em
prosa nem closure mutável. Confidence/reason permanecem metadados de provenance do claim; facts
produzidos por reads/writes preservam evidence própria.

Quanto à extração, o resultado é **A**: o Dental Pack fornece vocabulary, schema, prompt e
validação de Understanding consumidos por uma abstração genérica. Ele não importa OpenAI, SDK de
modelo ou provider. O adapter OpenAI existente fica em `src/infrastructure/adapters/ai/` e aponta
para o contrato/contribuição do pack, nunca na direção inversa. Um teste arquitetural protege
essa independência.

## Policy

`DentalPolicy` contém somente booleanos/números:

- autorização para divulgar preço;
- exigência de escalada humana;
- antecedência mínima para agenda;
- exigência de avaliação antes do booking.

Texto editorial, nomes, preços, horários e providers não entram em policy.

## ActionResults e honestidade dos efeitos

- `catalog_answered`: facts lastreados ao serviço exato.
- `slots_found`: cada label pertence ao slot e ao snapshot que o autorizou.
- `appointment_created` / `appointment_confirmed`: somente após sucesso do write port e com
  evidence desse write.
- `appointment_create_failed`, `appointment_confirmation_failed`,
  `clarification_required`: sem facts que aleguem sucesso.
- `escalation_required`: decisão estruturada, sem alegar handoff externo já realizado.

## Conflitos, dependências e falhas

Escalation declara conflito com Catalog e Scheduling. O coordinator bloqueia conflitos e
dependências ausentes antes de reads/writes. Uma falha em qualquer `decide()` também ocorre antes
do primeiro efeito porque o pipeline possui uma barreira global de decisões.

## Scars absorvidas

- preço deixa de depender de `isPriceRequestText`: Understanding seleciona request, Catalog
  resolve o serviço e o plano preserva preço↔serviço↔evidence;
- `isSchedulingRequestText` deixa de misturar disponibilidade e booking: Calendar reads e writes
  são fases distintas;
- `detectAppointmentConfirmation` deixa de interpretar `vou`: confirmação exige request
  estruturado e pending step;
- `messageOffersConcreteSlot` deixa de reler texto do agente: o slot é resolvido pela oferta
  persistida através do read port;
- manutenção/sábado não viraram novas keywords; seguem como resolução de catálogo/agenda.

## Deliberadamente fora de G

- composer e prompt produtivos do H;
- adapters e composition root de produção;
- outbound e delivery V2;
- shadow, V1×V2 e cutover;
- Information, Media, Objection, Discount e FollowUp capabilities;
- remoção de qualquer código legado.

O próximo ciclo precisa verbalizar somente `authorizedFacts`; não pode recuperar facts internos
nem desprender preço, slot ou appointment de seus subjects/evidence.
