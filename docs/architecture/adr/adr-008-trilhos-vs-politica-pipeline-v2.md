# ADR-008: Trilhos globais vs. política de conversa no pipeline (pipeline v2)

**Status:** Proposto — aguardando aprovação
**Data:** 2026-07-18
**Contexto:** Auditoria das conversas da madrugada de 18/07 (Vitalli) + frustração recorrente: "cada vez que mexe, aparece mais bug"

---

## Contexto (medido no código em 18/07/2026)

O comportamento de uma conversa hoje é **emergente** da interação de quatro fontes de configuração:

1. **Flags da org** (`organizations`): `offerSlotsAfterPriceEnabled`, experience (concierge/menu), voice mode, TTLs, debounce, menu items — ~30 knobs.
2. **Guards globais** no `ConversationOrchestrator.ts` (5.013 linhas): A3 (defer pitch), A4 (preço por quantidade), A5 (objeção de preço antigo), A6 (caso atípico), A9 (dedup de reenvio), P0.x (garantia, nome antigo) — cada um interagindo com todos os anteriores.
3. **Playbook** (notes, commercialPolicy, objections, mídia autorizada).
4. **Pipeline por treatment** (`pipelineSteps`: content/qa/photo/ask_availability/offer_slots/book).

Ninguém consegue ler um lugar só e prever o que a clínica vai responder. Cada pedido de cliente novo vira mais um flag de org + mais um ramo/guard no switch global — o `offerSlotsAfterPriceEnabled` (pedido da Vitalli) precisa de **7 condições de guarda** (`ConversationOrchestrator.ts:3902`) para não vazar para outras clínicas.

A auditoria de 18/07 (SystemOps, Vitor, Rick, Kaique, Ca, Bah) encontrou 4 bugs P0. A distribuição é o dado central deste ADR:

| Bug | Onde mora |
|---|---|
| Lista de horários sem persistir estado (`preferredDayEmpty`, linha 4933) → resposta numérica cai no menu órfão | Runtime global |
| `confirm_slot` sem oferta pendente → pergunta circular em vez de listar slots (linha 3335) | Runtime global |
| Pausa (`aiPaused`) engole "quero reservar um horario" sem reprocesso na retomada (linha 2479) | Runtime global |
| Content step do pipeline atropela a pergunta do lead (Instagram, localização, "qual da foto é a prêmio") e repete o mesmo bloco 2-3×/conversa | Pipeline (comportamento de dispatch do runtime) |

Conclusão dupla: (a) mover config para o pipeline **não teria evitado** 3 dos 4 bugs — os trilhos precisam existir e ser corrigidos globalmente; (b) a repetição e a falta de objetividade — a reclamação literal do cliente — vêm de política de conversa espalhada em flags e guards globais, onde ela não pode ser lida nem alterada por clínica com segurança.

---

## Decisão

Separar o sistema em **duas camadas com fronteira explícita**, evoluindo o que existe — sem rewrite.

### Camada 1 — Trilhos (runtime global, um só para todas as clínicas)

Critério de pertencimento: regra que protege o negócio ou o lead, **idêntica para qualquer clínica**. Bug aqui é corrigido uma vez, para todos.

- Segurança de canal: opt-out, rate limit, dedup (A9), pausa/takeover.
- Motor de agendamento: SlotEngine, reservas, janelas, sinal Pix, confirmação, lembretes.
- Estado: ConversationStateMachine, claims de processamento, outbox.
- Guards determinísticos de preço: A4 (quantidade só cota o que está na tabela), A6 (caso atípico não cota).
- Entrega: sequenciamento, TTS, resolução de mídia.

### Camada 2 — Política de conversa (pipeline v2, por clínica/tratamento)

Critério: **qualquer coisa que um cliente pediria diferente do outro**. O que dizer, quando, com qual mídia, com qual CTA. Tudo que hoje é flag de org modulando ramo global migra para propriedade de step.

### Invariante nova do runtime: answer-first

Pergunta do lead é respondida **antes** de qualquer step disparar ou avançar. Content step nunca substitui a resposta — no máximo vem depois dela, no mesmo turno. Isso é comportamento do runtime (vale para todo pipeline, sem config), e mata a classe inteira do bug nº 4.

### Schema do pipeline v2 (extensão do `PipelineStep` em `src/domain/entities/treatment.ts`)

```ts
// Novos campos — todos opcionais; ausência = comportamento atual (zero migração forçada).

type ContentStep = {
  type: "content";
  label: string;
  blocks: ContentBlock[];
  once?: boolean;          // default true no v2: bloco já enviado na conversa não repete;
                           // pipeline reiniciado pula para o próximo step não-consumido
};

type QaStep = {
  type: "qa";
  label: string;
  instruction?: string;
  maxTurns?: number;
  mediaOnKeywords?: { keywords: string[]; mediaId: string }[];
};

type PriceStep = {         // NOVO — absorve o offerSlotsAfterPriceEnabled
  type: "price";
  label: string;
  thenOfferSlots?: boolean; // após cotar, já oferta horários reais (sem "posso ver?")
  suppressTrailingCta?: boolean; // quando thenOfferSlots, a 1ª composição não pergunta
};

// deliveryFormat por step (voz): "text" | "audio" | "inherit" (default inherit do
// voice mode da clínica). Permite "saudação em áudio, preço sempre em texto".
type StepDelivery = { deliveryFormat?: "text" | "audio" | "inherit" };
```

Além dos steps, o pipeline v2 introduz **`clinicFacts`** (nível clínica, consultável de qualquer step): Instagram, região/bairro, estacionamento, formas de pagamento — fatos que hoje vivem em prosa nas notes e que o composer ignora quando um pipeline está ativo. Estruturado = o answer-first consegue responder sem depender de o LLM achar o fato no prompt.

### Migração dos flags de org (mapa)

| Hoje (org flag) | Destino no v2 |
|---|---|
| `offerSlotsAfterPriceEnabled` | `PriceStep.thenOfferSlots` (deprecar o flag) |
| voice mode global | `StepDelivery.deliveryFormat` por step (org mantém o default) |
| `greetingMessage` + experience | step inicial do pipeline (starter curado) |
| menu items | permanecem na org (experience menu_first é trilho de fallback) |
| TTLs, rate limit, debounce, deposit, businessHours, timezone | **permanecem na org** — são trilho |

### Fases de execução

- **Fase 0 (pré-requisito, cirúrgica):** corrigir os 4 P0s de 18/07 no runtime atual. Nenhuma dependência do v2.
- **Fase 1:** invariante answer-first + `once` no content step. Maior impacto na percepção do cliente (repetição some).
- **Fase 2:** `PriceStep.thenOfferSlots`; migrar a Vitalli; deprecar `offerSlotsAfterPriceEnabled`.
- **Fase 3:** `clinicFacts` estruturado + resolução no answer-first.
- **Fase 4 (contração):** mover os ramos por-clínica restantes do switch para steps; o switch encolhe para "o step atual trata? senão, qual trilho trata?".

Piloto: **Vitalli** (já é o laboratório e a origem dos pedidos). **Ximendes não é tocada** antes da Fase 2 estável — está live com leads reais e sem nenhuma das features novas ligadas.

---

## Apêndice de execução — decisões fechadas (não reabrir)

1. **Não é rewrite.** O orchestrator continua sendo o runtime; o switch encolhe por subtração ao longo das fases, nunca por substituição big-bang.
2. **Booking/sinal/opt-out nunca viram config de pipeline.** N cópias da mesma lógica = o mesmo bug N vezes, corrigido em um e esquecido nos outros.
3. **Pipeline é guia, não prisão** (mantido do design v1): intenção real de agendar sai do pipeline e o trilho de booking assume.
4. **`once` default true no v2.** Repetir bloco de apresentação é sempre bug de percepção; quem quiser repetir, configura `once: false`.
5. **Answer-first é invariante, não flag.** Não existe clínica que prefira ignorar a pergunta do lead.
6. **Fallback preservado:** treatment sem `pipelineSteps` continua no modo reativo atual. Zero mudança de comportamento para quem não migrar.

---

## Alternativas consideradas

- **Config 100% dentro de cada pipeline (proposta original):** rejeitada na forma pura — resolve a legibilidade por clínica, mas duplica trilhos (agendamento, sinal, segurança) por clínica e não teria evitado 3 dos 4 bugs P0 de 18/07.
- **Continuar com flags de org + guards globais:** rejeitada — é o gerador atual de comportamento emergente; cada cliente novo aumenta a superfície de interação entre flags.
- **Engine de fluxo externa (estilo Typebot/ManyChat):** rejeitada — perde o "sistema decide, LLM verbaliza" e o acoplamento com SlotEngine/sinal que é o diferencial do produto.

---

## Regras do repo

- Fase 0 sai em PR próprio (fixes cirúrgicos, sem schema novo), base `main`, com passagem do `revisor-multitenant`.
- Cada fase do v2 é um PR independente com fallback verificado (treatment sem pipeline = comportamento idêntico ao atual).
- Schema novo entra em `src/domain/entities/treatment.ts` com os mesmos comentários de decisão do v1 (⚠️ para questões abertas).
- Deprecação de `offerSlotsAfterPriceEnabled` só depois da Vitalli rodar 1 semana na Fase 2 sem regressão.

## Prioridade

Depois da Fase 0 (P0s corrigidos), a Fase 1 é a prioridade de produto: ataca diretamente a reclamação do cliente pagante (repetição/objetividade). Fases 2-4 seguem conforme validação na Vitalli.

## Esforço estimado

- Fase 0: 1 dia (4 fixes cirúrgicos + testes).
- Fase 1: 2-3 dias (answer-first exige reordenar o dispatch do pipeline no orchestrator).
- Fase 2: 1-2 dias. Fase 3: 2 dias (schema + UI de settings). Fase 4: contínua, por subtração.
