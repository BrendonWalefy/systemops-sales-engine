# Superfície LLM → canal externo

> Ciclo B6, 15/08. Derivado do código, não de auditoria manual.
> Guardado por [`LlmOutboundBoundary.test.ts`](../../src/__tests__/LlmOutboundBoundary.test.ts)
> e [`LlmOutboundHumanGate.test.ts`](../../src/__tests__/LlmOutboundHumanGate.test.ts).

## Por que este documento existe

A auditoria do Ciclo B mediu **chamadores de `ResponseComposer.compose()`** e concluiu que a
superfície estava fechada em 4/6. `cron/recovery-campaign` escrevia o próprio prompt, chamava a
OpenAI direto e enfileirava para o lead sem tocar naquela classe. A métrica não estava errada por
pouco — estava medindo outra coisa.

A métrica correta não conta chamadores de uma classe. Conta **caminhos em que texto de modelo
alcança um canal externo**, e exige que os autônomos atravessem plano → gerador → validador →
fallback.

## Onde há geração de texto

Levantado por import de pacote de modelo (`openai`, `@anthropic-ai/sdk`) e pelos wrappers internos:

| Módulo | Papel |
| --- | --- |
| `core/intelligence/ResponseComposer` | Composer principal da conversa |
| `core/intelligence/IntentClassifier` | Classificação — não produz texto para lead |
| `core/intelligence/PlaybookAdvisor` · `FieldComposer` | Edição de playbook no painel |
| `infrastructure/llm/advisor-llm` | Wrapper usado por insights, reativação e classificação de desfecho |
| `app/api/cron/recovery-campaign/route` | Prompt próprio da campanha de recuperação |
| `app/(clinic)/app/inbox/recovery-actions` | Prompt próprio do recovery manual |
| `app/api/conversations/[id]/suggest-reply/route` | Sugestão para o operador |
| `infrastructure/adapters/agents/llm-sales-agent-gateway` | Sem chamadores — código morto |

## Onde há saída para canal externo

`enqueueOutboundMessage`, `sendTextMessage`, `sendMediaMessage`, `sendButtonListMessage`, `sendEmail`.

## O mapa

| Path | LLM source | Destination | Autonomous? | Human gate? | Authorized Plan? | Validator? | Trace? | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `core/pipeline/ConversationOrchestrator` | ResponseComposer | lead / WhatsApp | sim | não | **sim** | **sim** | **sim** | A — protegido |
| `cron/appointment-reminder/route` | ResponseComposer | lead / WhatsApp | sim | não | **sim** | **sim** | **sim** | A — protegido |
| `cron/follow-up-dispatcher/route` | ResponseComposer | lead / WhatsApp | sim | não | **sim** | **sim** | **sim** | A — protegido |
| `cron/recovery-campaign/route` | prompt próprio | lead / WhatsApp | sim | não | **sim** | **sim** | **sim** | A — protegido (B6) |
| `conversations/[id]/pipeline-actions/route` | via `orchestrator.handle` | lead / WhatsApp | sim | não | **sim** | **sim** | **sim** | A — protegido |
| `whatsapp/zapi/route` | via `resumeAfterHumanReviewDecision` | lead / WhatsApp | sim | não | **sim** | **sim** | **sim** | A — protegido |
| `inbox/recovery-actions` | prompt próprio | lead / WhatsApp | **não** | **sim** | não | não | não | B — provado |
| `reactivation/dispatch-campaign` | `advisor-llm` (via banco) | lead / WhatsApp | **não** | **sim** | não | `validateDraft` | não | B — provado |
| `jobs/send-message-job` | — | provider | — | — | — | — | — | transporte |
| `lib/tts-send` | — | provider | — | — | — | — | — | transporte |
| `cron/post-appointment-followup` | — (template) | lead / WhatsApp | sim | não | n/a | n/a | não | sem texto de LLM |
| `playbook/simulate/route` | ResponseComposer | resposta HTTP | — | — | — | — | — | C — provado |
| `demo/generate-demo-conversation` | ResponseComposer | banco de demo | — | — | — | — | — | C — provado |
| `app/actions` (demo pública) | ResponseComposer | navegador | — | — | **sim** | **sim** | não | C — protegido mesmo assim |
| `conversations/[id]/suggest-reply` | prompt próprio | resposta HTTP | — | — | — | — | — | C — provado |
| `cron/conversation-insights` | `advisor-llm` | tabela de insights | — | — | — | — | — | C — provado |
| `reactivation/classify-lead-outcomes` | `advisor-llm` | banco | — | — | — | — | — | C — provado |
| `playbook/advisor/*` | PlaybookAdvisor · FieldComposer | painel | — | — | — | — | — | C — provado |
| `scripts/recovery-campaign.ts` | prompt próprio | lead / WhatsApp | **não** | `--send` explícito | não | não | não | B — script manual¹ |

¹ Script local, fora do deploy. `DRY_RUN` é o default; enviar exige `--send` digitado à mão.

## Contagem

```
AUTONOMOUS_EXTERNAL encontrados: 6
protegidos:                      6
sem proteção:                    0

HUMAN_APPROVED_EXTERNAL:         2  (+1 script manual fora do deploy)
INTERNAL_ONLY:                   7
```

## O que impede o próximo bypass

[`llm-outbound-graph.ts`](../../src/application/channel-safety/llm-outbound-graph.ts) deriva a
superfície do grafo de imports a cada `npm test`.
[`llm-outbound-registry.ts`](../../src/application/channel-safety/llm-outbound-registry.ts) declara
a classificação de cada caminho. Módulo descoberto e não declarado **quebra o CI nomeando o
módulo**; declarado como `autonomous_external` sem atravessar a fronteira também.

O alcance por imports superestima e nunca subestima — o lado seguro. Os dois falsos positivos são
declarados (`transport_only`, `no_llm_text`) em vez de filtrados no analisador.

**Ponto cego declarado:** texto que viaja pelo **banco** entre geração e envio não aparece no
grafo. `reactivation/dispatch-campaign` é esse caso e está no registro com `manualOnly: true`, com
teste garantindo que entradas manuais são exatamente as que o grafo não vê.

## Catálogo autorizado (Ciclo B7)

`AuthorizedResponsePlan` carrega `allowedServices` — nome do catálogo, aliases cadastrados e o
preço **daquele** serviço, preenchido só quando a clínica o marcou cotável em chat. Dois códigos
de violação usam isso:

| Código | Quando dispara | Onde está ligado |
| --- | --- | --- |
| `service_price_mismatch` | Preço citado cuja janela nomeia outro serviço e não o dono | Todo caminho que declara catálogo |
| `unauthorized_service` | Token do catálogo sobrevive depois de mascarar os termos autorizados | Só onde `strictServiceVocabulary: true` (recuperação) |

`strictServiceVocabulary` fica **desligado** na conversa aberta de propósito: lá o composer discute
procedimentos em prosa livre, e falso positivo custa uma resposta boa a um lead real. Ligá-lo
depende de medir falso positivo contra o corpus — Ciclo C.

## Limitações conhecidas

1. **Serviço inventado sem vocabulário do catálogo não é detectado.** A checagem é ancorada nos
   termos autorizados; pegar um substantivo de serviço arbitrário exigiria conhecer o universo de
   nomes de procedimento. Registrado como teste em `AuthorizedServiceFacts.test.ts`.
2. **O caminho de resposta a mídia não declara catálogo.** Ele compõe antes de `clinicTreatments`
   ser carregado (`ConversationOrchestrator:4319`); cobrir exigiria uma query nova naquele ramo,
   sem medição.
3. **`validateDraft` da reativação não é o `ResponseValidator`.** Tem checagem própria de menção a
   dinheiro (`extractMoneyMentions`) e limite de tamanho. É mais fraco que o plano autorizado, e
   aceitável só enquanto a dupla aprovação humana existir.
