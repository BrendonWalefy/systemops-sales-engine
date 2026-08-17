# Ciclo I — shadow, comparação V1×V2 e gate interno

Data: 2026-08-17  
Checkpoint H: `99a852aa382c0327e221923f93509bb6151fdb3f`  
Base da Task 7: `b54e165098af02e06a6613d275f705df056b657f`  
Matriz e boundaries finais: `8e2c7b9506325ba0831c2962ec75033e666dd978`

## Estado terminal

O Ciclo I entregou os instrumentos, as fronteiras de shadow e o selector reversível, mas não
produziu evidência V1×V2 autorizada. O estado real commitado tem zero observações, manifest e
gate report sem assinatura, nenhum resultado de comparação, nenhuma revisão humana e nenhum
replay/Lab full-turn aprovado. Os 13 gates bloqueantes estão `not_measurable` e a decisão do
artifact é `NO_GO`.

Nenhum tenant ou canal foi ativado. O runtime não possui rota live V2: `v2_internal` continua
fail-closed em V1 mesmo para tenant de teste. V1, rollback, outbox e sender permanecem íntegros.

## Checkpoints implementados

| Etapa | Checkpoint final | Evidência principal |
| --- | --- | --- |
| H — entailment | `99a852aa` | composer/validator/renderer determinísticos e sem modelo |
| I/Task 1 — prepare/complete | `bd5c7ec5` | decisão canonicalizada antes de qualquer execute |
| I/Task 2 — captured reads/shadow | `0faea93a` | reads imutáveis e writes convertidos em intended effects |
| I/Task 3 — comparação/gates | `d8febfc4` | schemas fechados, HMAC, protocolo e gate report |
| I/Task 4 — seam V1 | `e86201ad` | observação turn-local sem contaminar a decisão V1 |
| I/Task 5 — runtime pós-sender | `9899fb8b` | selector, sink sanitizado, admission deadline e drain |
| I/Task 6 — instrumento V1×V2 | `b54e1650` | runner attestation-first; revisão independente limpa |
| I/Task 7 — matriz final | `8e2c7b95` | jornadas críticas e boundaries finais |

## Arquitetura entregue

```text
V1 produtiva
  -> observações plain-data das leituras realmente usadas
  -> acknowledgement + outbox V1
  -> tentativa awaited do sender
  -> barrier registrada
  -> selector tenant-scoped
       v1                  -> encerra
       v1_with_v2_shadow   -> captured-read V2
       v2_internal         -> V1 (runtime live indisponível/fail-closed)
  -> Understanding V2
  -> prepare: claims + decide
       decisão read-only   -> complete + H deterministic response
       decisão write       -> would_have_executed HMAC; sem execute/texto
  -> comparison record sanitizado, se o sink ainda for admitido
```

O core genérico permanece sem V1, provider, DB, calendário, config, persistência de comparação
ou Domain Pack. O Dental Pack declara vocabulary, schema, claims, capabilities e ports, mas não
conhece OpenAI ou outro provider. O composition root produtivo fica fora do core.

### Mesmas leituras, sem contaminação

O V2 shadow só recebe `CapturedV2TurnReads`, criado das observações V1 anteriores aos efeitos.
Captured read ausente retorna `shared_read_unavailable`; não há fallback para DB, calendário ou
catálogo produtivo. Outcome, resposta e efeito V1 ficam no braço de controle e não entram em
Understanding, claim, decide, plano ou texto V2.

### Writes e sender

Uma decisão `execute` para antes de `Capability.execute()`. O Dental adapter aceita somente
`book_slot` e `confirm_appointment`, produz `would_have_executed` com payload HMAC e não produz
`ActionResult`, `AuthorizedResponsePlan` ou `FinalText`. Action desconhecida é `unsupported`.

O batch só começa depois do settlement da tentativa do sender, inclusive quando a falha já foi
tratada. Persistência de comparação é observabilidade best-effort; não é porta de capability e
não escreve estado, agenda, CRM, outbox ou canal.

## Deadline canônico

`deadlineAt` é deadline de admissão, não promessa de retorno até T:

- nenhuma nova operação externa ou async relevante começa em/depois de T;
- toda operação admitida antes de T é observada e drenada até conclusão/falha;
- provider recebe `AbortSignal`, mas cancelamento só é contado quando o erro tipado confirma;
- Drizzle/Neon é prechecked antes do início e awaited depois; abort de fetch não prova ausência
  de commit server-side;
- retorno após T durante drain é overrun mensurado, nunca compliance estrito;
- summary é criado depois do drain; nenhuma mutation pode ser despachada depois dele;
- strict return-by-T + zero órfão + zero commit pós-retorno exige outra execution boundary e
  permanece requisito futuro, sem worker/redesign YAGNI neste ciclo.

## Protocolo congelado e resultado real

| Item | Estado |
| --- | --- |
| População protocolar | 17 casos válidos do manifesto Cycle F |
| Comparáveis predeclarados | 15 casos |
| Não comparáveis | `scheduling-0003`, `burst-0002` |
| Motivo dos dois | `structured_pending_state_absent` |
| Repetições | `N = 6` por braço |
| Ordem | pares adjacentes `V1_i → V2_i` |
| Posições protocolares | 17 × 6 × 2 = 204 |
| Alvo comparável | 90 por braço, 180 total |
| Observações reais | 0 |
| D0 sensitivity intersection | vazia |
| Resultado V1×V2 | ausente |
| Manifest authority | ausente (`authoritySignature: null`) |

`OPENAI_API_KEY` não estava disponível no ambiente herdado da Task 6. O runner não carregou
`.env.local`, não chamou os braços e registrou `openai_api_key_missing` com
`attemptedObservations: 0`. Ausência de medição não foi convertida em PASS, estabilidade ou
equivalência.

O run manifest commitado referencia o snapshot de implementação da Task 6 (`94b554ee`). Qualquer
medição futura precisa gerar e assinar um manifest novo que corresponda exatamente ao HEAD/tree,
source digest, runtime, corpus, comparabilidade, fixtures, modelos, prompts e adapters usados;
o artifact atual não autoriza chamadas nem ativação.

## Métricas por camada

| Camada | Instrumento | Resultado |
| --- | --- | --- |
| Understanding suportado | 15 casos × 6 × 2 | `not_measurable`; 0/180 observado |
| Protocolo completo | 17 casos × 6 × 2 | `not_measurable`; 0/204 observado |
| Decision/ActionResult | manifest v2 + reads/receipts content-bound | `not_measurable`; manifest ausente |
| Prosa | 90 pares aprovados + dois reviewers calibrados | `not_measurable`; pares/ratings ausentes |
| Custo full-turn | replay aprovado em Lab isolado | `not_measurable` |
| Latência p95 full-turn | replay aprovado em Lab isolado | `not_measurable` |

O judge segue `experimental_non_gating`: instabilidade medida de 42,9%, acima do teto aprovado
de 25%. Não foi usado para preencher o gate qualitativo. Não há human-review sheet, dois
reviewers calibrados, `replay-dataset.v2` aprovado nem registro de Lab com automação desligada.
Métricas de componente e custo zero do renderer H não foram renomeados como full-turn.

## Matriz de jornadas

| Jornada | Classe | Evidência exercida | Estado |
| --- | --- | --- | --- |
| price | happy | preço/subject/evidence capturados; ID interno não verbalizado | supported |
| availability | happy | somente slots do snapshot; nenhum ID/evidence ref no texto | supported |
| booking intent | boundary | seleção pendente vira `would_have_executed`; sem execute/resultado/texto | supported em shadow |
| write failure | failure | falha do write permanece `effect_failed`; zero fato de sucesso | supported offline |
| escalation | recovery | `human_action_required`; não afirma handoff concluído | supported |
| multi-intent | adversarial | subject A/B preservados; cross-link rejeitado; IDs não expostos | supported no H |

Boundary adicional: captura obrigatória ausente para antes do provider e retorna
`shared_read_unavailable`. Media, Objection, Discount e FollowUp permanecem
`unsupported/deferred`; nenhuma capability foi criada para preencher a matriz.

Esta matriz é evidência determinística de contracts e segurança. Ela não substitui as 204
observações do protocolo, revisão humana nem replay full-turn.

## Entailment, privacidade e observabilidade

Os testes H continuam sustentando:

```text
semantics(finalText) ⊆ semantics(validatedDraft) ⊆ semantics(authorizedPlan)
```

Plan/draft precisam de registro runtime, snapshot plain-data frozen e integridade referencial.
Repair só reduz, fallback nasce do mesmo plano e o renderer usa templates fechados. Failure não
vira success, disponibilidade não vira booking, escalation não vira handoff concluído e intended
effect não vira efeito executado.

Registros live usam refs `hmac:<64 hex>` e schemas fechados. Não carregam mensagem, histórico,
prompt, resposta, nome, telefone, email, URL, provider payload, DB ID ou evidence ref em claro.
O artifact commitado contém somente metadata/digests; sua assinatura ausente o impede de virar
autoridade.

## Trust boundary da avaliação

O bootstrap canônico captura a attestation antes de importar dotenv, CLI, runner, providers ou
application graph. O source digest é calculado por Node sobre escopo fechado e vincula path,
mode, size e bytes; symlink, escape, alias/hardlink, arquivo irregular ou mudança durante captura
falham fechado. Commit/tree/status permanecem defesa e rastreabilidade adicionais.

Essa attestation opera dentro de um substrato confiável explícito: OS/filesystem, Node, `tsx`,
dependências instaladas do lockfile, bootstrap mínimo e ausência de mutação concorrente do host.
Ela não prova integridade contra host, runtime ou supply chain comprometidos. Se essa ameaça entrar
no escopo, será necessária boundary externa imutável/assinada de build ou CI.

## Findings, correções e rejeições

- Task 5: a promessa anterior de strict wall-clock com zero órfão e zero commit pós-retorno foi
  confirmada como indemonstrável nas portas atuais. A spec foi corrigida prospectivamente para
  admission deadline + cooperative cancellation + mandatory drain.
- Task 5: evidência de overrun com clock malformado/regressivo e distinção entre abort solicitado
  e confirmado foram confirmadas e corrigidas por RED → GREEN; re-review final passou.
- Task 6: authority sintética, denominadores alteráveis, accessors/proxies de clock e evidências
  humanas/replay não alcançáveis foram confirmados e fechados com schemas/registries/assinaturas.
- Task 6: bypasses de attestation por `PATH`, Git env/config, flags de index e stat cache foram
  confirmados. A fronteira final usa bootstrap mínimo e source digest de bytes.
- A alegação de que self-attestation in-process provaria segurança contra host/supply chain
  comprometidos foi rejeitada como garantia demonstrável; tornou-se limite explícito, sem ampliar
  o escopo com worker/build system novo.
- Nenhum finding executável foi descartado por conveniência. A revisão independente final da
  Task 6 retornou SPEC PASS / QUALITY PASS, sem Critical/Important; um Minor documental foi
  corrigido em `b54e1650`.
- A revisão adversarial independente final da Task 7 é uma etapa posterior ao presente
  checkpoint. Até artifact content-bound e assinado existir, `adversarial_review` permanece
  corretamente `not_measurable` no gate report.

## Gate report

O artifact `evals/cycle-i/gate-report.json` tem 13 critérios bloqueantes e todos estão
`not_measurable`: `h_entailment`, `shadow_no_effects`, `protocol_integrity`,
`supported_understanding`, `supported_decision`, `critical_regressions`, `qualitative`,
`full_turn_cost`, `full_turn_p95`, `rollback`, `observability`, `verification` e
`adversarial_review`.

Há testes determinísticos verdes para várias dessas propriedades, mas o gate de ativação exige
evidence artifacts content-bound/autorizados. Resultado de suíte local não é promovido para
assinatura ou PASS do gate report.

## Rollback e ausência de ativação

- default e rollback imediato: `organizations.conversation_engine = 'v1'`;
- `observe` e `disabled` nunca executam shadow/V2;
- `v1_with_v2_shadow` exige configuração explícita e automation `live`;
- `v2_internal` sempre resolve para V1 nesta implementação;
- não existe path V2 para writer, BookingService, calendário, outbox ou canal;
- V1 não foi removida e nenhuma alteração irreversível/cutover foi feita;
- nenhuma policy, tenant ou canal foi ativado nesta execução.

## Gaps bloqueantes

1. Reexecutar o protocolo produtivo por bootstrap canônico com manifest novo, assinado e
   source/runtime binding exatos.
2. Obter 204 posições válidas, preservando 24 `not_measurable` predeclaradas e 180 observações
   comparáveis, sem drop ou braço emprestado.
3. Fornecer manifest Decision v2 completo; resolver canonicamente a incompatibilidade de
   `scheduling-0003` antes de qualquer receipt.
4. Produzir os 90 pares de prosa aprovados e duas revisões humanas distintas/calibradas, ou um
   instrumento substituto previamente calibrado.
5. Produzir replay sanitizado, humano-aprovado e assinado em Lab isolado para custo médio e p95
   full-turn equivalentes.
6. Gerar artifacts content-bound das evidências determinísticas, verificação e review; assinar o
   gate report somente se todos os critérios bloqueantes forem PASS.
7. Mesmo após gates PASS, desenhar/revisar separadamente o shell produtivo live que preserve
   dedupe, state, durable outbox e delivery. O Ciclo I não o implementa.

## Verificação da Task 7

A matriz/boundaries foi desenvolvida em RED → GREEN: o comando focal iniciou com os três arquivos
ausentes (exit 1) e terminou com 3 arquivos/21 testes verdes.

- suíte focal exata do plano: 24 arquivos/235 testes verdes;
- agenda: 4 arquivos/86 testes verdes;
- auditoria PII executada diretamente, sem dotenv: 40 arquivos, zero finding bloqueante;
- `db:check`, typecheck e `git diff --check`: verdes;
- `npm run verify`, executado com worktree clean depois do commit documental: Drizzle meta OK,
  lint com zero erro e um warning legado em V1, typecheck verde, 358 arquivos/3.144 testes
  verdes e 11 skips;
- `git diff 99a852aa -- src/core src/conversation-core`: somente o split genérico de pipeline e
  a seam observacional V1 previamente revisados; a Task 7 não alterou esses diretórios.

A revisão independente da Task 7 ocorre depois deste checkpoint. Os resultados locais não alteram
retroativamente o gate report unsigned nem fabricam observações V1×V2.

NO-GO INTERNAL V2
