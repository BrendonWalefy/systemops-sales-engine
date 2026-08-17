# Ciclo I — shadow, comparação V1×V2 e gate interno

Data: 2026-08-17

Checkpoint H: `99a852aa382c0327e221923f93509bb6151fdb3f`

Base da Task 7: `b54e165098af02e06a6613d275f705df056b657f`

Matriz e boundaries finais: `8e2c7b9506325ba0831c2962ec75033e666dd978`

Hardening da revisão Task 7: `5e3f2c64`

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

A chave observada pela busca de slots V1 inclui duração, janela, horário preferido e janelas de
atendimento que a chave V2 atual não representa. O mapper não descarta esses campos e chama o
resultado de equivalente: ele deixa `slotSearches` vazio. Portanto availability no shadow
produtivo é `unsupported/deferred` com `shared_read_unavailable`; o Ciclo I não adicionou uma
capability nem um mapping lossy para fazê-la parecer suportada.

### Writes e sender

Uma decisão `execute` para antes de `Capability.execute()`. O Dental adapter aceita somente
`book_slot` e `confirm_appointment`, produz `would_have_executed` com payload HMAC e não produz
`ActionResult`, `AuthorizedResponsePlan` ou `FinalText`. Action desconhecida é `unsupported`.

O batch só começa depois do settlement da tentativa do sender, inclusive quando a falha já foi
tratada. Persistência de comparação é observabilidade best-effort; não é porta de capability e
não escreve estado, agenda, CRM, outbox ou canal.

O seam V1 observa planos intermediários de resposta, mas não possui autoridade sobre o artifact
final realmente enviado. Por isso o braço V1 do live record é `unavailable` com
`final_response_unavailable`, e o record inteiro é `not_measurable` com divergências fechadas em
lista vazia. Um plano intermediário nunca é promovido a final V1, e um V2 diferente não gera
divergência fabricada. `model.calls` só é materializado quando o callback do provider foi de fato
invocado; duplicate e shared-read unavailable antes desse callback registram `model: null`.

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

Cada célula está explicitamente classificada. `N/A` significa que o modo não pertence ao contrato
da jornada indicada; não significa PASS implícito.

| Jornada | happy | boundary | failure | adversarial | recovery |
| --- | --- | --- | --- | --- | --- |
| price | supported: runtime verbaliza apenas preço autorizado | supported: missing capture falha fechado antes do provider | N/A: não há write | N/A: cross-subject pertence a multi-intent | N/A: pertence a escalation |
| availability | **unsupported/deferred**: promoção V1 real resulta `shared_read_unavailable` | N/A: já falha no shared-read boundary | N/A: shadow não admite write | N/A: pertence a multi-intent | N/A: sem capability de recovery |
| booking intent | N/A: shadow não executa booking | supported: `would_have_executed` HMAC sem resultado/texto | N/A: write failure é contrato offline | N/A: sem cross-subject write | N/A: sem recovery executável |
| write failure | N/A: success write é proibido no shadow | N/A: boundary coberta pelo booking intent | supported offline: permanece `effect_failed` | N/A: sem cross-subject write | N/A: falha não é convertida em recovery |
| escalation | N/A: é outcome de recovery | N/A: handoff concluído está fora do contrato | N/A: não há write de handoff | N/A: pertence a multi-intent | supported: `human_action_required`, nunca handoff concluído |
| multi-intent | N/A: happy paths single-subject estão separados | N/A: capture boundary coberta em price | N/A: teste não contém write | supported no H: subject A/B preservados e cross-link rejeitado | N/A: não há policy de recovery multi-intent |

Media, Objection, Discount e FollowUp permanecem `unsupported/deferred`. A evidência não vem de
uma constante local: o pack real expõe apenas price/availability/scheduling e o runner real
retorna `unsupported_request` para cada request fora do vocabulário fechado. Nenhuma capability
foi criada para preencher a matriz.

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
- A primeira revisão independente da Task 7 retornou SPEC FAIL / QUALITY FAIL com 3 Important e
  3 Minor. Os três Important foram confirmados: availability havia sido fabricada no teste; o
  braço V1 vazio era marcado `observed`; e a matriz era um Set global com deferred autoafirmado.
  O hardening `5e3f2c64` substituiu esses claims por runtime real, status
  `unavailable/not_measurable` e matriz explícita journey×mode.
- Os Minor de contagem de modelo, scan arquitetural direto e whitespace também foram confirmados
  e corrigidos: contagem nasce no callback real, o scan percorre o grafo local transitivo e
  `git diff --check b54e1650..HEAD` é gate explícito.
- A re-review independente da Task 7 ainda é posterior a este checkpoint. Até artifact
  content-bound e assinado existir, `adversarial_review` permanece corretamente `not_measurable`
  no gate report.

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
ausentes (exit 1) e terminou com 3 arquivos/21 testes verdes. No hardening da revisão, os RED
reproduziram availability real como `unsupported`, V1 vazio marcado `observed` e model call
contado antes do callback; os GREEN fecharam esses três caminhos e elevaram a suíte Task 7 para
3 arquivos/24 testes.

- suíte focal exata do plano: 24 arquivos/241 testes verdes;
- regressões Task 5/shadow: 10 arquivos/171 testes verdes;
- regressões Task 4/V1: 6 arquivos/74 testes verdes;
- agenda: 4 arquivos/86 testes verdes;
- auditoria PII executada diretamente, sem dotenv: 41 arquivos, zero finding bloqueante;
- `db:check`, typecheck e `git diff --check`: verdes;
- `npm run verify`, executado com worktree clean depois do commit documental: Drizzle meta OK,
  lint com zero erro e um warning legado em V1, typecheck verde, 358 arquivos/3.144 testes
  verdes e 11 skips no checkpoint inicial; após o hardening, 358 arquivos/3.150 testes verdes e
  11 skips;
- `git diff 99a852aa -- src/core src/conversation-core`: somente o split genérico de pipeline e
  a seam observacional V1 previamente revisados; a Task 7 não alterou esses diretórios.

A primeira revisão independente da Task 7 encontrou os gaps acima. A re-review do hardening
ocorre depois deste checkpoint. Os resultados locais não alteram retroativamente o gate report
unsigned nem fabricam observações V1×V2.

NO-GO INTERNAL V2
