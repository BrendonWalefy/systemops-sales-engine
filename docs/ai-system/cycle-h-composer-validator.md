# Ciclo H — Composer, Validator e renderer semântico

Base: `7fb114f0`. Checkpoint reaberto: `32e6dd82`. Hardening revisado: `417e0c10`.

Status: **GO definitivo para o gate de segurança semântica do Ciclo H**. Nenhuma parte do Ciclo I
foi iniciada.

## Decisão canônica do gate

A spec registra `CI-V2-H-GATE-2026-08-16`, antes de qualquer resultado final V1×V2 do Ciclo I. H
é o gate de segurança semântica:

```text
semantics(finalText) ⊆ semantics(validatedDraft) ⊆ semantics(authorizedPlan)
```

`judge ≥ V1` saiu do gate H e continua obrigatório no I. O judge atual é
`experimental_non_gating`: instabilidade 42,9%, acima do limite aprovado de 25%. A comparação I
continua pareada/intercalada, com mesmo N, primary analysis dos casos estáveis, sensitivity
analysis dos instáveis, critério fixado antes do resultado e judge calibrado ou human-review/
instrumento substituto previamente calibrado.

A mudança corrige etapa e instrumento; não reduz qualidade. Composer/renderer H fazem zero
chamadas a provider/model, portanto o custo de inferência do estágio H é zero. Isto não compara o
custo do estágio isolado com um turno V1 completo.

## Fronteiras finais

```text
Domain Pack OutcomeSchema
  -> untrusted executed ActionResults
  -> canonicalize once + runtime shape/schema/provenance + deep freeze
  -> canonical plan builder
  -> branded + graph-validated + frozen AuthorizedResponsePlan
  -> ResponseComposerPort
  -> unknown/untrusted draft
  -> canonicalize once into plain frozen DraftResponse
  -> validate that exact snapshot
  -> ValidatedDraftResponse<ConcreteOutcomeType>
       invalid -> reductive repair -> validate
       invalid -> same-plan fallback -> validate
  -> closed deterministic renderer
  -> readonly + frozen CoreResponse/FinalText
```

Brands TypeScript são acompanhadas por registros runtime em `WeakSet`/`WeakMap`; casts estruturais
não promovem objetos.

## Findings originais

| Finding | Resultado | Causa e correção |
| --- | --- | --- |
| CRITICAL 1 — validator valida um draft e registra outro | **CONFIRMADO → CORRIGIDO** | validação/branding reliam o objeto hostil; agora canonicalizam, congelam, validam e registram o mesmo snapshot |
| CRITICAL 2 — language contribution acrescenta semântica | **CONFIRMADO → CORRIGIDO** | labels arbitrários eram branded; contribution removida e templates são fechados |
| CRITICAL 3 — OutcomeType contradiz semanticClass | **CONFIRMADO → CORRIGIDO** | campos independentes; registry do Domain Pack virou fonte única de tipo/runtime e requisitos |
| IMPORTANT 1 — plan não era trust boundary | **CONFIRMADO → CORRIGIDO** | builder canônico, runtime shape/schema/grafo, brand, freeze e remoção do callback `buildPlan` |
| IMPORTANT 2 — subject desaparecia no texto | **CONFIRMADO → CORRIGIDO** | subjectRef em todos os acts, public display separado do ID e desambiguação multi-subject |
| IMPORTANT 3 — OutcomeType widen para string | **CONFIRMADO → CORRIGIDO** | união concreta atravessa plan, composer, validator, validated draft, renderer e pipeline |
| IMPORTANT 4 — relações incoerentes | **CONFIRMADO → CORRIGIDO** | dangling/duplicate refs e relações outcome/fact/option/subject/evidence falham fechado |
| IMPORTANT 5 — gate H/I contraditório | **CONFIRMADO → CORRIGIDO** | decisão canônica separa segurança em H e qualidade comparativa em I |

## Findings adicionais do hardening independente

- **OutcomeSchema TOCTOU — CONFIRMADO → CORRIGIDO.** Cada campo é materializado uma vez; o
  snapshot exato é validado/registrado.
- **ActionResult provenance TOCTOU — CONFIRMADO → CORRIGIDO.** A pipeline canonicaliza uma vez
  após `execute()`, valida owner no snapshot congelado e entrega o mesmo conjunto ao builder.
- **runtime records/casts inválidos — CONFIRMADO → CORRIGIDO.** Origin, subject, evidence, facts,
  options, disclosure e value kinds recebem validação estrutural antes do brand.
- **subject em failure/human/clarification — CONFIRMADO → CORRIGIDO.** Esses acts carregam e
  validam subjectRef; failures cross-subject ficam distintos.
- **display escapava do slot nominal — CONFIRMADO → CORRIGIDO.** DisplayName continua dado
  autorizado do plan, mas é JSON-delimitado; controles/separadores Unicode são rejeitados.
- **texto variável podia virar prosa do renderer — CONFIRMADO → CORRIGIDO.** `display_text` é
  material plan-authorized e sempre renderizado como literal delimitado.
- **subjects distintos com display igual — CONFIRMADO → CORRIGIDO.** Em multi-subject, labels
  públicos não injetivos falham fechado; IDs nunca são expostos.
- **FinalText mutável — CONFIRMADO → CORRIGIDO.** `CoreResponse` é readonly/frozen.
- **atos válidos duplicados ampliavam output — CONFIRMADO → CORRIGIDO.** Duplicatas globais são
  violações e repair preserva uma cópia congelada na primeira posição.
- **WeakSet permitiria cross-schema — REJEITADO.** O builder sempre reaplica
  `assertActionResultMatchesOutcomeSchema` em cada resultado; A→B falha com schema mismatch.

## RED → GREEN

- getter do draft trocava failure por success; agora há uma leitura e o failure permanece;
- `Desconto garantido` entrava por language label; a entrada foi removida e extras são ignorados;
- failure/escalation/slots/media como completed e completed sem write evidence agora falham em
  compile-time e runtime;
- versão/ref/brand/buildPlan forjados e relações incoerentes agora falham fechado;
- price(A)+slots(B), failure(A)+failure(B) e displays públicos duplicados agora desambiguam ou
  falham fechado;
- schema accessor mudava `write_required` para `optional`; agora lê uma vez;
- origin accessor mudava owner entre pipeline/builder; agora o snapshot tem uma leitura;
- records com origin/subject/key numéricos e evidence inválida agora retornam invalid shape;
- 1.000 atos idênticos geravam ~15 mil caracteres; agora repair/dedupe renderiza uma ocorrência;
- `CoreResponse.text` aceitava mutação; agora `Reflect.set` retorna false.

## Sustentação do entailment

`validatedDraft ⊆ authorizedPlan`: plan/draft exigem registro runtime; cada act referencia nós
existentes e compatíveis; disclosure, ownership, subject e evidence são checados; repair só remove;
fallback usa o mesmo plan e revalida. UNKNOWN não vira FALSE, options não viram completed, failure
não vira success, escalation não vira handoff concluído e media disponível não vira media sent.

`finalText ⊆ validatedDraft`: renderer recupera somente o plan associado ao draft, usa templates
fechados, não recebe callbacks/language/provider, resolve apenas refs validadas, delimita material
lexical autorizado, desambigua subjects e devolve snapshot final congelado.

## Independência de domínio/provider

Confirmada a opção **A**: o Dental Pack fornece Outcome Schema, capabilities e dados para
abstrações genéricas; não conhece OpenAI/model/provider. O core não contém literal dental.
`src/conversation-core/composer/**` não importa/chama provider, modelo, DB, calendário, config,
Domain Pack, rede ou I/O.

## Verificação

- focada H/G/arquitetura: **27 arquivos, 136 testes verdes**;
- agenda: **4 arquivos, 86 testes verdes**;
- `npm run verify`: Drizzle meta OK; lint 0 erros/1 warning legado V1; typecheck verde;
  **332 arquivos, 2.884 passes, 11 skips (2.895 total)**;
- `git diff 7fb114f0 -- src/core`: **vazio**;
- auditoria provider/model/domain/config/I-O no composer: **zero**;
- comportamento dental novo no core genérico: **zero**;
- revisão independente final: **GO**, 7 arquivos/68 testes + 8 arquivos/27 testes verdes,
  typecheck verde, sem CRITICAL/IMPORTANT remanescente;
- push, PR, merge, cutover e Ciclo I: **não executados**.

## Gates

1. CRITICAL reproduzidos/corrigidos: **PASS**.
2. IMPORTANT de autoridade: **PASS**.
3. Entailment adversarial: **PASS**.
4. TOCTOU/alias/proxy/accessor/mutação: **PASS**.
5. OutcomeType→semanticClass/subject/evidence: **PASS compile/runtime**.
6. Segunda autoridade lexical: **removida — PASS**.
7. Zero modelo/provider no H; custo de inferência H zero: **PASS**.
8. Suítes/verify/V1 diff: **PASS**.

## Minors/gaps restantes

1. Não há caps estruturais para plan/acts únicos/chars. Plano com 1.000 facts autorizados gerou
   16.889 caracteres. É dívida de availability, não bypass de entailment; fechar antes de I/outbound.
2. `ComposerStyle` permanece no port/pipeline, mas o composer determinístico ignora e o renderer
   não recebe. É abstração dormente, não autoridade.
3. `CoreResponse.parts` fica vazio no H. Outbound, composition root, shadow V1×V2, avaliação
   qualitativa e política de `no_safe_response` pertencem ao I.
4. Renderer probabilístico futuro exige validação pós-render antes do outbound.

Nenhum gap restante amplia autoridade no renderer H atual.

## Commits do hardening

- `f624f25a` gate H/I; `5ed6b881` snapshots/language; `f677c461` graph/branded plan;
- `41082e54` type widening; `1c095c01` subjects; `52571c63` FinalText frozen;
- `417e0c10` schema/action-result canonical e ataques finais.

Após o parecer independente, o minor de schema forjado com resultado vazio foi fechado com RED →
GREEN por `assertOutcomeSchema(schema)` na entrada canônica; ele não permanece como dívida.

## Decisão

**GO definitivo para encerrar o Ciclo H. PARE aqui; não iniciar o Ciclo I.**
