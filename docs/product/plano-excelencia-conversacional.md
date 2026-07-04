# Plano — Excelência Conversacional: da demo curada para a produção

**Data**: 04/07/2026
**Objetivo**: as respostas da IA em produção ficarem indistinguíveis das mensagens curadas
da demo Odonto Marques (`src/application/demo/demo-conversation-scripts.ts`) — o nível que
faz o lead elogiar o atendimento como elogiaria um humano excelente.

**Documentos-irmãos**: `auditoria-conversacao-2026-07.md` (falhas reais da Ximendes),
`demo-roteiro-uau.md` (a demo), `cost-control.md` (custos), `sales-playbook.md`.

---

## 1. O diagnóstico honesto: por que a demo encanta

Fato central que muda a estratégia: **as mensagens admiráveis da demo foram escritas à
mão, não geradas pelo modelo**. Em `generate-demo-conversation.ts`, quando o turno tem
`agent:` preenchido, o texto curado é usado verbatim — o `ResponseComposer` (gpt-4o-mini)
só entra nos turnos sem texto curado. As 10 conversas "cenário perfeito" da Odonto Marques
são copy humano de alto nível.

Isso é **ótima notícia**, por dois motivos:

1. O alvo está materializado e é nosso. Não precisamos adivinhar o que é "excelente" —
   temos ~80 mensagens de referência prontas para virar guia de estilo, exemplares de
   prompt e golden set de avaliação.
2. O gap não é místico ("o modelo não é bom o suficiente") — é decomponível em 4 camadas
   concretas (§3), e a maior parte não é modelo.

## 2. Anatomia das mensagens curadas — as 7 técnicas

O que o copy curado faz, extraído das conversas da Marina, para virar especificação:

| # | Técnica | Exemplo nas curadas |
|---|---|---|
| 1 | **Responde a pergunta imediatamente E acolhe o contexto emocional na mesma abertura** | Camila cita casamento → "Que fase especial, parabéns pelo casamento 🤍" + já explica as opções |
| 2 | **Valida a emoção antes de argumentar** (medo, vergonha, desconfiança) | "Entendo perfeitamente — essa é a preocupação mais comum e a mais importante" |
| 3 | **Prova em vez de promessa** | Desenho digital ("você vê o resultado antes de decidir"), vídeo como evidência, "a maioria dos pacientes fala 'era só isso?'" |
| 4 | **Preço com âncora + degrau de baixo compromisso** | "A partir de R$ 1.800 por dente" + "a avaliação custa R$ 150 e já sai com o desenho do seu caso" — nunca preço seco, nunca desconversa |
| 5 | **Espelha o registro do lead** | Humor ↔ humor ("aqui não fazemos 'sorriso de porcelanato'" 😄), formalidade ↔ "a senhora" (Sonia), medo ↔ calma |
| 6 | **Memória de detalhes pessoais** | Irmã da Sonia → "pode vir com a sua irmã se quiser companhia"; casamento em outubro → "dá tempo com folga" |
| 7 | **Um próximo passo claro, uma pergunta no máximo, sempre avançando o funil** | Toda mensagem termina conduzindo: explicar → ver vídeo → avaliar → escolher horário → confirmar |

Nota: o prompt atual do `ResponseComposer` é majoritariamente **defensivo** (9 regras do
que NÃO fazer: não inventar, não repetir nome, não exceder emojis). Ele não ensina o arco
persuasivo acima e não tem um único exemplar de resposta excelente. É regra sem repertório.

## 3. De onde vem o gap real (4 camadas)

Cruzando as curadas com a auditoria das 62 conversas reais da Ximendes:

### Camada 1 — Orquestração quebrada (F1, F2, F4, F7, F9) · ~40% do gap percebido
Saudação genérica engolindo a pergunta, respostas em série contraditórias na rajada,
follow-up às 02:43, slot reoferecido como indisponível, tokens de mídia órfãos.
**Nenhum upgrade de modelo compensa isso** — com rajada quebrada, o GPT-5 responderia
lindamente a pergunta errada, duas vezes.

### Camada 2 — Conteúdo comercial faltante (F5) · ~30% do gap
A Marina da demo encanta porque **sabe tudo**: preço por procedimento, avaliação R$150,
parcelamento, nomes dos doutores, prazos. A IA da Ximendes não tem preço de 10 lentes,
3x sem juros, manutenção R$500, recontorno R$250/dente, sinal R$30, promoções. Nenhum
modelo verbaliza o que não recebeu. Copy excelente com conteúdo vazio vira poesia evasiva.

### Camada 3 — Escrita e persuasão (prompt) · ~20% do gap
O composer atual produz texto "correto porém morno": não valida emoção antes de
argumentar, não espelha registro, não apresenta preço com degrau. É exatamente o que as
7 técnicas do §2 + exemplares few-shot resolvem — ajuste fino, custo ~zero.

### Camada 4 — Modelo · ~10% do gap
Dois papéis, duas conclusões:
- **IntentClassifier (gpt-4o-mini)**: erra intents reais (F1, F3, F8 — "estou aqui na
  frente" virou `acknowledgment`). Caminho preferido do produto: guards determinísticos
  (padrão PR #104); benchmark de modelo em paralelo.
- **ResponseComposer (gpt-4o-mini)**: candidato real a upgrade — é onde "escrita boa"
  vira "escrita admirável". Mas só medível depois das camadas 1-3.

## 4. Resposta direta: precisamos subir o modelo da OpenAI?

**Custo não é o bloqueador — nunca foi.** Números do piloto (cost-control.md):

- OpenAI hoje: **~R$3/mês** (US$0,41 em 12 dias) = **1,5% do custo de infra**. Z-API é 97%.
- Volume real: ~470 mensagens de IA/mês. Mesmo colocando o **modelo topo de linha só no
  composer**, a ordem de grandeza é **R$20-40/mês** — contra margem bruta de ~R$1.100+
  por clínica Start. Um modelo intermediário (classe gpt-4.1-mini / gpt-5-mini) fica em
  centavos de real por dia. (Validar com a tabela vigente da OpenAI e acompanhar em
  `ai_usage_costs` / `/owner/financeiro`.)

**Mas a sequência importa mais que o modelo.** Subir modelo agora seria pagar (pouco) para
mascarar sintoma: as falhas que os leads sentem hoje (camadas 1 e 2) não são de modelo.
A decisão correta é a do §5 — fundações → conteúdo → persuasão → **medir** → e então
fazer o upgrade do composer **com benchmark provando o delta**, não por fé.

Expectativa realista: camadas 1-3 fecham ~80-90% do gap percebido; o upgrade do composer
é o polimento final da escrita — barato, e provável de valer a pena, mas por último e medido.

## 5. O plano por fases

### Fase 1 — Fundações que nenhum modelo compensa (P0 da auditoria) · 1-2 semanas
Executar os 5 itens P0 de `auditoria-conversacao-2026-07.md`:
1. Guard anti-saudação-genérica (rajada com pergunta de negócio nunca recebe concierge).
2. Quiet hours + timezone nos follow-ups; suprimir quando operador ativo.
3. Resposta única por rajada; cancelar outbound pendente quando o contexto muda.
4. Bug do slot reoferecido como indisponível (caso Aylane).
5. Higiene de mídia (conectivos órfãos, `**` → `*`, mídia real quando pedida).

**Dono**: `engenheiro-conversa`. **Critério**: replay dos casos da auditoria sem regressão.

### Fase 2 — Conteúdo comercial completo (a IA sabe o que o operador vende) · paralelo à Fase 1
1. Onboarding de conteúdo da Ximendes: preços 10 lentes, 3x sem juros/21x, manutenção
   R$500, recontorno R$250/dente, sinal R$30 (P0.4 da auditoria).
2. Feature de **promoção com validade** (campanhas que o operador hoje dispara na mão).
3. **Checklist de completude do playbook** no publish: procedimento sem preço/parcelamento/
   próximo-passo cadastrado gera aviso ao owner — transforma o gap de conteúdo em
   diagnóstico visível, para toda clínica futura (conecta com a iniciativa config ownership).

**Dono**: `engenheiro-conversa` + owner (conteúdo da clínica).

### Fase 3 — Camada de persuasão e emoção (o "especialista") · 1 semana após Fase 1
1. **Manual de voz do atendimento** (`docs/product/manual-voz-atendimento.md`): destilar
   as 7 técnicas do §2 em guia normativo com exemplos bons/ruins por situação — objeção
   de preço, medo/vergonha, "vou pensar", lead cita a origem, pós-procedimento.
2. **Composer ensina o arco, não só as regras**: acrescentar ao system prompt o arco
   `acolher → responder → provar → avançar` + **exemplares few-shot universais** (2-3 por
   situação crítica, adaptados das curadas, sem dados de clínica — comportamento universal
   vive no prompt, dado comercial vive no banco, conforme guardrail). Custo de tokens do
   few-shot no volume atual: desprezível.
3. **Template de playbook** (`docs/agent-guides/clinic-playbook-template.md`) ganha seção
   de "jogadas" persuasivas por situação, para o conteúdo específico de cada clínica.
4. **Agente `engenheiro-conversa` atualizado** com o mandato de persuasão/emoção e o
   manual de voz como fonte da verdade (feito em 04/07/2026, junto com este plano).

**Critério**: no simulador, respostas para o roteiro da demo ficam lado a lado com as
curadas sem vergonha.

### Fase 4 — Harness de qualidade: medir "tão bom quanto" · junto com a Fase 3
1. **Replay harness** (P3.17 da auditoria): transcrições reais da Ximendes + roteiros da
   demo viram testes de regressão (mensagem do lead → intent/ação esperada).
2. **LLM-judge com rubrica de 5 eixos**, nota por resposta: (a) respondeu a pergunta?
   (b) acolheu a emoção? (c) avançou o funil com 1 pergunta no máximo? (d) fiel à política
   comercial? (e) tom natural, sem call-center?
3. **Golden set** = mensagens curadas da demo (nota-teto de referência) + os 10 padrões de
   falha da auditoria (nota-piso a superar).
4. Gate: mudança de prompt/modelo só entra com score ≥ baseline no harness.

**Dono**: `engenheiro-conversa`.

### Fase 5 — Benchmark de modelo (agora sim, com dados) · após Fases 1-4
1. **Composer A/B no harness**: gpt-4o-mini (baseline) vs classe intermediária
   (gpt-4.1-mini / gpt-5-mini) vs classe alta — julgados pelo LLM-judge cego, custo real
   medido via `ai_usage_costs`.
2. **Classificador**: manter mini + guards determinísticos (padrão do produto). Se o
   harness mostrar teto de acurácia de intent mesmo com guards, benchear modelo também.
3. O `ResponseComposer` já escolhe modelo por plano/env e usa Responses API para GPT-5.x;
   `IntentClassifier` continua configurável por env para benchmark, com fallback mini.
4. **Critério de decisão**: upgrade se o delta do judge for perceptível nas situações
   críticas (objeção, medo, preço) — o custo já sabemos que é irrelevante (§4).

**Donos**: `engenheiro-conversa` (qualidade) + `especialista-infra` (custo/margem).

## 6. Métricas de sucesso

| Métrica | Hoje (auditoria jun-jul/2026) | Meta |
|---|---|---|
| Primeira resposta útil (vs saudação genérica engolindo pergunta) | falha frequente (F1) | ~100% |
| Lead `lost` sem nunca receber resposta de preço | comum (Julllys et al.) | 0 |
| Score LLM-judge médio no replay | a medir (baseline Fase 4) | ≥ 90% do score das curadas |
| Follow-up fora de horário útil | 8+ leads às 02:43 | 0 |
| Agendamentos por conversa | 12/36 no piloto (33%) | subir e acompanhar |

## 7. Ordem de execução resumida

| Quando | O quê | Fase |
|---|---|---|
| Semana 1-2 | P0 da auditoria + onboarding de conteúdo Ximendes | 1 + 2 |
| Semana 2-3 | Manual de voz + arco/few-shots no composer + template | 3 |
| Semana 3 | Replay harness + LLM-judge + golden set | 4 |
| Semana 4 | A/B de modelo no composer; decisão por dados | 5 |

> **Resposta curta à pergunta que originou este plano**: dá para chegar muito perto do
> nível das curadas só com engenharia e ajuste fino (fases 1-3), porque o que separa a
> produção da demo é majoritariamente orquestração, conteúdo e prompt — não modelo. O
> upgrade do composer provavelmente vale a pena como polimento final e custa dezenas de
> reais por mês, não centenas — mas fazemos por último, medido pelo harness, para pagar
> apenas pelo delta que o lead realmente percebe.
