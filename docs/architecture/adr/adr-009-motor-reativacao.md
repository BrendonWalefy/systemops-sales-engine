# ADR-009: Motor de Reativação — campanhas de reengajamento segmentadas

**Status:** Proposto — execução iniciada pela Fase 1
**Data:** 2026-07-22
**Contexto:** Cliente-piloto (Clínica Vitalli) contratou trabalho humano para fazer follow-up de pacientes que não fecharam, segmentando por motivo e enviando oferta com prazo. O produto não faz isso hoje. A capacidade precisa ser universal (qualquer clínica), configurável, e segura no disparo.

---

## Contexto

A demanda chegou como um direcionamento escrito pelo próprio cliente à sua recepcionista:

> "Fazer follow-up de pacientes semana passada e retrasada e verificar o porquê não fechou (ler um trecho da conversa). Pacientes que não fecharam por valor, enviar oferta para fechar no máximo até sexta."

Decompondo, são quatro capacidades distintas:

1. **Janela de audiência** — "semana passada e retrasada".
2. **Motivo de não-fechamento com evidência** — "verificar o porquê não fechou (ler um trecho da conversa)".
3. **Segmentação por motivo** — "que não fecharam por valor".
4. **Oferta com prazo + disparo** — "enviar oferta para fechar no máximo até sexta".

O sistema já resolve a parte mais cara e arriscada dessa cadeia — o disparo seguro:

| Capacidade existente | Onde |
|---|---|
| Outbox unificada (produtor → fila → sender) | `src/application/jobs/enqueue-outbound-message.ts` |
| Safety Gate: opt-out, caps horário/diário, quiet hours, warmup | `src/application/channel-safety/outbound-safety-gate.ts` |
| Categoria `campaign` já prevista e já gated | `outbound_message_category` em `schema.ts` |
| Reputation Engine / health score do número | `src/application/channel-safety/reputation-engine.ts` |
| Disparo em lote com dedupe e janela de contato | `src/app/api/cron/recovery-campaign/route.ts` |
| Oferta promocional por tratamento, com validade e liga/desliga | tabela `price_campaigns` + UI em settings/tratamentos |
| Freios: `automated_reengagement_paused`, `channel_safety_mode` | `reengagement-policy.ts`, gate |

O que **não** existe:

- `leads.lost_reason` é texto livre e só recebe o literal `"inatividade"` (`mark-stale-leads.ts`). Nada classifica *por que* o lead não fechou.
- Não há noção de **audiência** declarativa. Os filtros de exclusão existem, mas soterrados num SQL literal dentro do `recovery-campaign`.
- Não há objeto **campanha** ligando audiência + oferta + prazo, nem revisão humana antes do disparo.
- O `recovery-campaign` atual dispara por critério **operacional** (o lead ficou sem resposta — falha nossa), não **comercial** (o lead recusou e queremos reconquistar).

---

## Decisão

Criar o **Motor de Reativação**: audiência declarativa + motivo de perda classificado + campanha com oferta e prazo, **produzindo mensagens na outbox existente**.

### Princípio arquitetural inegociável

> Campanha **não** é um canal novo de envio. É mais um produtor de outbox.

Todo disparo segue exatamente o caminho já validado: compõe → pré-registra em `messages` → `enqueueOutboundMessage(category: "campaign")` → Safety Gate → `sender-worker` → provider. Nenhuma rota paralela, nenhum `sendTextMessage` direto. Isso mantém opt-out, caps, quiet hours, warmup e kill switch valendo de graça, e mantém o guardrail do `AGENTS.md`: o sistema decide, a LLM verbaliza.

### As quatro peças

**A. Motivo de não-fechamento com evidência (`lead_outcomes`)**

Enum fechado de motivos + o **trecho literal da conversa** que sustenta a classificação + confiança + qual modelo classificou. A evidência não é enfeite: é o que torna a classificação auditável pela clínica e o que o cliente pediu explicitamente ("ler um trecho da conversa"). Correção humana sobrescreve e trava a classificação automática (`source = 'human'` nunca é sobrescrito por `'llm'`).

**B. Audiência declarativa (`AudienceResolver`)**

Segmento como objeto validado (janela temporal, status, motivo, tratamento) + exclusões de segurança sempre aplicadas (opt-out, agendamento ativo, contato recente, cap lifetime). **Preview obrigatório** antes de qualquer disparo — ninguém aperta enviar às cegas para 200 pessoas.

**C. Campanha com revisão em lote (`reactivation_campaigns` + `_targets`)**

Uma campanha é: audiência + oferta (FK opcional para `price_campaigns`, que já existe) + prazo + modo de mensagem. Cada lead vira um *target* com um rascunho gerado por IA. A clínica **revisa em lote** — aprova, edita ou rejeita vários de uma vez — e só então a campanha enfileira. Aprovação humana é obrigatória enquanto a campanha nunca rodou.

**D. Modo ensaio (teste com número real)**

Uma campanha pode apontar para um **lead de teste** da própria clínica. Nesse modo todos os rascunhos são gerados contra os leads reais, mas a entrega vai para a conversa do lead de teste, com cabeçalho identificando o destinatário original.

> Detalhe que só apareceu lendo o código: `send-message-job.ts` valida `automationDestinationMatchesLead(payload.to, context.lead)` e cancela o envio se o destino não bater com o lead da conversa. Portanto o modo ensaio **não pode** simplesmente trocar o `to` — precisa apontar `conversationId` para a conversa do lead de teste. Fazer diferente seria descobrir isso em produção como `invalid_automation_context`.

Modo ensaio é superior a `DISABLE_REAL_WHATSAPP_SEND` porque exercita o caminho inteiro até o WhatsApp de verdade.

### Modelo de IA e controle de custo

Duas operações usam LLM: classificar o motivo e redigir o rascunho. Ambas são assíncronas, fora do caminho síncrono do WhatsApp, e a qualidade importa mais que a latência — é o oposto do `IntentClassifier`. Decisão: **`claude-sonnet-5` via `callAdvisorLLM`**, coerente com o que o ADR-002 já faz para o setup study.

Ordem de grandeza (Sonnet 5 a US$ 2/US$ 10 por MTok, preço introdutório até 31/08/2026): ~1.500 tokens de entrada e ~200 de saída por lead ≈ **US$ 0,005 por lead por operação**. Uma campanha de 200 leads custa cerca de **US$ 2** ponta a ponta. Um único paciente recuperado paga isso centenas de vezes — a economia aqui seria falsa. `gpt-4o-mini` custaria ~US$ 0,10 na mesma campanha, e erra exatamente onde não pode errar: distinguir "achou caro" de "não era o tratamento certo".

Controles obrigatórios, porque barato não é o mesmo que ilimitado:

1. Registro em `ai_usage_costs` com operação própria — hoje `callAdvisorLLM` **não** devolve `usage`, então o gasto do advisor é invisível. Isso precisa ser corrigido junto.
2. Preços de modelos Claude no `cost-estimator.ts` (a tabela só conhece modelos OpenAI hoje).
3. Teto diário por clínica; ao estourar, a operação adia em vez de gastar.
4. Reclassificação só quando a conversa mudou desde a última (hash da última mensagem).
5. Modelo configurável por env (`REACTIVATION_MODEL`), com fallback barato disponível sem mudar código.

---

## Alternativas consideradas

**Estender o `recovery-campaign` existente.** Descartado. Ele responde a uma pergunta diferente — "quem ficou sem resposta por falha nossa" — e o critério é tempo de silêncio. Enfiar segmentação comercial ali acopla duas políticas que precisam evoluir separadamente, e mexer num cron que já roda em produção para dois clientes live é risco desnecessário. Os dois vão coexistir e compartilhar o `AudienceResolver` e a outbox.

**Disparo direto sem revisão humana.** Descartado para a v1. O primeiro disparo em lote testa os caps de verdade pela primeira vez, sobre números de clientes reais. Revisão obrigatória enquanto a campanha nunca rodou; automação plena só depois de histórico.

**`lost_reason` como texto livre preenchido pela LLM.** Descartado. Texto livre não segmenta — "achou caro", "preço alto" e "valor" viram três segmentos distintos. Enum fechado + evidência em texto separado resolve os dois lados.

**Deixar a clínica escolher o modelo de IA no painel.** Descartado pelo mesmo motivo do ADR-004: polui a interface, gera suporte e queima margem.

---

## Consequências

**Positivas**

- Fecha um buraco competitivo real: hoje o cliente paga um humano para fazer o que o produto deveria fazer.
- Reaproveita a infra mais cara já paga (outbox, Safety Gate, caps, opt-out, `price_campaigns`).
- A evidência textual dá à clínica um motivo para confiar na classificação — e vira material de venda ("olha por que seus pacientes não fecharam").
- Métrica de campanha (enviados → responderam → agendaram → R$) é a prova de valor que sustenta renovação.
- Torna-se módulo vendável por plano, via `module-catalog`.

**Negativas / trade-offs**

- Superfície de risco reputacional cresce: disparo em lote é o cenário clássico de ban de número. Mitigado por caps já existentes + cap por campanha + ramp + aprovação + modo ensaio, mas o risco não é zero.
- Classificação errada gera oferta errada, que é pior que não enviar. Mitigado por evidência visível e revisão humana.
- Mais uma tabela de configuração por clínica para manter coerente com `sources-of-truth.md`.

**Pré-requisito**

O bug `garantia-objecao-nao-surge` (a IA ignora objeção cadastrada e pivota para "avaliação") precisa ser corrigido antes da Fase 4. Uma campanha de recuperação por preço cujo lead responde e recebe de volta um desvio para "vamos marcar uma avaliação" desperdiça a campanha inteira no primeiro turno.

---

## Fases

| Fase | Entrega | Risco de envio |
|---|---|---|
| 1 | Motivo de não-fechamento classificado + relatório | **Nenhum** — não envia nada |
| 2 | Audiência + campanha em rascunho + revisão em lote | **Nenhum** — não envia nada |
| 3 | Modo ensaio → disparo real com ramp e kill switch | Controlado |
| 4 | Contexto de campanha na conversa + métricas de resultado | — |

Plano detalhado, com mapeamento arquivo a arquivo: [`docs/product/motor-reativacao-plano-execucao.md`](../../product/motor-reativacao-plano-execucao.md).
