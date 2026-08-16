# Ciclo H — Composer, Validator e renderer semântico

Checkpoint inicial: `7fb114f0` (desenho H aprovado).

## Escopo entregue

O H transforma resultados já decididos em texto controlado, inteiramente em memória:

```text
ActionResult<OutcomeType>
  -> V2AuthorizedResponsePlan<OutcomeType>
  -> ResponseComposerPort
  -> DraftResponse
  -> Validator determinístico
     -> repair redutivo -> nova validação, quando necessário
     -> fallback do mesmo plano -> validação, quando necessário
  -> ValidatedDraftResponse
  -> renderer determinístico
  -> CoreResponse.text
```

Não foram adicionados composition root produtivo, outbound, provider de modelo, shadow,
comparação V1×V2, cutover ou qualquer parte dos ciclos I/J.

## Propriedade de segurança

O contrato preservado é:

```text
semantics(finalText) ⊆ semantics(validatedDraft) ⊆ semantics(authorizedPlan)
```

- o plano é a única autoridade;
- o composer seleciona e ordena referências já autorizadas;
- o validator prova integridade referencial, disclosure e compatibilidade semântica;
- repair somente remove;
- fallback deriva somente do mesmo plano e valida o resultado;
- o renderer recebe snapshots validados e usa templates fechados.

O `turn-pipeline` recebe apenas composer, style e linguagem validados e chama o pipeline H
diretamente. Não aceita callback capaz de devolver texto pronto. O pipeline H também não aceita
callback arbitrário de renderer.

## ActionResult e identidade do outcome

`ActionResult<OutcomeType>` preserva:

- `type`: outcome concreto, tipado genericamente e pertencente à capability/Domain Pack;
- `semanticClass`: uma das seis classes genéricas fechadas;
- `origin.capabilityId`;
- subject do outcome;
- evidence do outcome;
- facts com subject, evidence e disclosure;
- options estruturadas, exclusivamente para `options_found`.

O parâmetro `OutcomeType` atravessa `Capability`, coordinator, `DomainPack`, turn pipeline e
`V2AuthorizedResponsePlan`. O core sabe que existe uma identidade string tipada, mas não conhece
nenhum literal dental. O Dental Pack declara sua própria união `DentalOutcomeType`.

## Plano autorizado como grafo

O builder não achata resultados:

```text
AuthorizedOutcome<OutcomeType>
  -> subjectRef
  -> evidenceRefs
  -> factRefs
  -> optionRefs

AuthorizedOption
  -> subjectRef
  -> factRefs

AuthorizedFact
  -> subjectRef
  -> evidenceRef
  -> disclosure
```

Subjects e evidence recebem refs determinísticas e são deduplicados pela identidade completa.
Facts divulgáveis sem subject, `options_found` vazio e options ligadas a outra classe falham
fechado. Isso mantém outcomes multi-intent separáveis.

## DraftResponse

O draft não contém prosa livre. Os atos suportados são:

| Speech act | Referências obrigatórias |
| --- | --- |
| `inform_fact` | `outcomeRef`, `factRef`, `subjectRef` |
| `offer_options` | `outcomeRef`, `subjectRef`, `optionRefs` |
| `confirm_effect` | `outcomeRef`, `subjectRef`, `factRefs` |
| `communicate_failure` | `outcomeRef` |
| `inform_required_action` | `outcomeRef` |
| `ask_clarification` | `outcomeRef` |

O composer determinístico olha somente `semanticClass`, disclosure e refs. Ele não inspeciona
mensagem do usuário, tipo concreto de outcome, fact key/value, subject type ou vocabulário do
domínio para decidir.

## Validator determinístico

O validator rejeita, com violation codes estruturados:

- draft ou conjunto de refs vazio onde o ato exige refs;
- outcome, fact, subject ou option inexistente;
- fact ou option pertencente a outro outcome;
- troca de subject;
- fact com `disclosure != allowed`;
- speech act incompatível com a classe do outcome.

A matriz fechada é:

| Semantic class | Único speech act permitido |
| --- | --- |
| `information_authorized` | `inform_fact` |
| `options_found` | `offer_options` |
| `effect_completed` | `confirm_effect` |
| `effect_failed` | `communicate_failure` |
| `human_action_required` | `inform_required_action` |
| `clarification_required` | `ask_clarification` |

O validator cria snapshots profundos suficientes e congelados do draft e do plano. Somente o
snapshot registrado em `WeakMap` recebe a marca `ValidatedDraftResponse`; o renderer recupera o
plano correspondente por esse registro. Mutações posteriores nos objetos de origem não alteram
o texto.

## Repair

Repair é deliberadamente redutivo: percorre o draft original, valida cada ato isoladamente,
remove atos inválidos e duplicatas exatas e preserva a ordem dos sobreviventes. Não corrige refs,
não troca subjects e não sintetiza atos.

```text
semantics(repairedDraft)
  ⊆ semantics(originalDraft) ∩ semantics(authorizedPlan)
```

Todo repair passa novamente pelo validator antes do renderer.

## Fallback

Fallback reconstrói um draft conservador apenas a partir do mesmo plano, usa a mesma matriz
fechada, seleciona no máximo um ato por outcome e valida internamente o resultado. Pode omitir
material, mas não cria outcome/fact/option/subject, não muda classe e não eleva disclosure. Sem
material seguro retorna `null`; o pipeline retorna `no_safe_response` sem texto.

```text
semantics(fallback) ⊆ semantics(authorizedPlan)
```

## Renderer determinístico

O renderer aceita somente:

- `ValidatedDraftResponse` registrado pelo validator;
- `ValidatedResponseLanguageContribution` imutável e registrada pelo factory;
- style com enums fechados.

Cada speech act escolhe um template fixo. Valores vêm somente dos facts referenciados e
divulgáveis. A contribuição de linguagem aceita apenas locale, labels nominais curtos e formatos
fechados; não aceita callbacks, prompts, regras operacionais ou facts de instância. Uma falha de
cobertura da linguagem fecha o pipeline com `reason: render_failed`.

O renderer não escolhe outcome, fact, slot, preço, subject, sucesso ou falha. `CoreResponse.parts`
permanece vazio neste recorte; nenhum efeito de mídia ou outbound existe.

## Casos críticos e multi-intent

Os testes provam:

- options/slots não podem usar `confirm_effect`;
- `effect_failed` não pode produzir sucesso, inclusive falhas de criação/confirmação;
- `human_action_required` permite apenas informar necessidade, nunca handoff concluído;
- informação de mídia não equivale a `media_sent`;
- ausência/UNKNOWN não cria fact booleano falso nem negação;
- preço, slot, desconto, garantia ou atributo clínico não autorizado não podem ser
  referenciados;
- uma option ligada a outro outcome e troca de subject são rejeitadas;
- `price(subject-A) + slots(subject-A)` preserva outcomes/refs separados;
- `price(subject-A) + slots(subject-B)` não admite cross-link.

## Independência de domínio e provider

`src/conversation-core/composer/**` não importa Domain Pack, OpenAI, provider, banco, calendário,
tenant config ou I/O. Comportamento específico dental introduzido no core H: **ZERO**.

Quanto à separação solicitada, o resultado continua sendo **A**: o Dental Pack fornece apenas
schema/contribuição declarativa de linguagem consumida pela abstração genérica. Ele não conhece
OpenAI, modelo ou provider concreto. O core H também não conhece provider concreto.

## Evidência RED → GREEN

- grafo autorizado: testes falharam sobre o plano achatado; ficaram verdes com outcome/refs;
- validator/composer: imports inexistentes produziram RED; matriz e refs fecharam GREEN;
- repair/fallback/pipeline: módulos ausentes e draft inválido chegando ao renderer produziram
  RED; validação e redução fecharam GREEN;
- renderer/language: módulos ausentes produziram RED; templates controlados fecharam GREEN;
- bypass do turno e regressões: API antiga e drafts vazios produziram RED; gate H real fechou
  GREEN;
- hardening: callback arbitrário, mutação pós-validação e linguagem forjada produziram RED;
  snapshots, registro runtime e renderer interno fecharam GREEN;
- outcome concreto: o teste de tipo mostrou widening para `string`; o genérico `OutcomeType`
  fechou GREEN sem vocabulário de domínio no core.

## Verificação

- Suíte focada H/G/arquitetura: 18 arquivos, 75 testes, todos verdes.
- Regressões de agenda exigidas: 4 arquivos, 86 testes, todos verdes.
- `npm run verify`:
  - Drizzle meta: OK;
  - lint: 0 erros e 1 warning legado em `src/core/intelligence/ResponseComposer.ts`;
  - typecheck: verde;
  - Vitest completo: 331 arquivos, 2.848 passes e 11 skips (2.859 total).
- Diff de `src/core/**` contra `7fb114f0`: zero.

## Surpresas e desvios

- O desenho intermediário permitia injetar um callback `render`; removido porque texto poderia
  ganhar semântica depois do validator.
- O primeiro fechamento do turn pipeline ainda aceitava `respond(plan)`; removido pelo mesmo
  motivo e substituído por dependências H estruturadas.
- Draft, plano e linguagem validados inicialmente mantinham aliases mutáveis; substituídos por
  snapshots congelados registrados em runtime.
- O outcome concreto era preservado em valor, mas alargado para `string` no contrato de
  capability; `OutcomeType` agora permanece tipado genericamente.
- O plano previa um callback de renderer em pseudocódigo. O contrato final é propositalmente mais
  restrito e chama o renderer determinístico dentro do pipeline.

## Gaps reservados para I

- composition root/adapters de produção e seleção de configuração por tenant;
- outbound e garantias de delivery;
- shadow/V1×V2, observação e comparação de qualidade;
- eventual renderer probabilístico, que exigiria validator pós-render antes de outbound;
- política operacional para `no_safe_response` no runtime real;
- novas capabilities e cutover.

Nenhum desses itens foi iniciado no H.
