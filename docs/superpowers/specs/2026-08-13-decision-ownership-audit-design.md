# Auditoria de propriedade de decisão no prompt e nos guardrails

Data: 2026-08-13
Status: aprovado, execução autorizada
Posição no programa: spec 3 de 4 — depende da resolução da spec 1 e do instrumento da spec 2

## 1. Decisão

Inventariar toda decisão que o sistema toma sobre a conversa, indexada **por decisão** e não
por linha, identificar as que têm mais de um dono, e retirar a duplicação do prompt mantendo o
guard determinístico — cada retirada num PR próprio e medida.

## 2. O problema, com evidência

O prompt do classificador acumulou ~78 linhas de regra e o do composer ~86, escritas uma a uma
conforme bugs apareciam em produção. Nenhuma dessas adições verificou se a decisão já tinha
dono. O resultado é que **cinco decisões têm dois donos**, contrariando a §7.3 da spec mestre
("nenhum dado terá dois donos"):

| Decisão | Guard determinístico | Regra duplicada no prompt |
| --- | --- | --- |
| Ambiguidade entre variações de tratamento | `detectAmbiguousTreatmentTerm` — casa nome e aliases contra o catálogo e conta | 4 linhas pedindo "corresponder a 2 OU MAIS procedimentos" |
| Manutenção fora de catálogo | `detectUncataloguedMaintenanceInquiry` | regra de `needs_human` |
| Identificação do tratamento | `resolveDirectTreatmentMention`, `resolveInformationalTreatmentTarget` | ~10 linhas de `identifiedTreatment` |
| Chegada do paciente | `detectPatientArrivalText` | 6 linhas de exemplos |
| Pergunta de horário de atendimento | `isBusinessHoursQuestion`, `buildBusinessHoursAnswer` | regras de `general_question` |

O caso da ambiguidade é o mais nítido: o guard faz correspondência exata contra o catálogo
real e conta quantos casam; o prompt pede que o modelo faça a mesma contagem de memória. É a
família do bug conhecido de cotar o valor errado entre duas variações do mesmo tratamento.

**Estas duplicações não produzem resposta errada** — o guard roda depois da classificação e
sobrepõe. O dano é outro, e foi medido: as regras duplicadas ocupam a maior parte do prompt e
disputam atenção com os julgamentos que só o modelo pode fazer. No estrato B do eval, o
`gpt-4o-mini` classificou `"quanto custa"` como `general_question` — frase que o prompt cita
textualmente como `price_inquiry`.

### 2.1 Um defeito de natureza diferente

`isSaturdayQuestionForOperatingClinic` está fixo em sábado, e `buildBusinessHoursAnswer` só
trata `sabado` e `domingo` como pergunta de dia específico. O comentário do próprio guard
admite: *"Enquanto o parser não souber o resto da semana, o sistema não afirma o que não sabe."*

Segunda a sexta não tem caminho determinístico. Isso é **falta de dado**, não atenção diluída,
e nenhuma limpeza de prompt resolve. Vai para a spec 4.

## 3. O objetivo mudou de acurácia para custo

Consequência da troca para `gpt-5.4-mini` (PR #265), que acerta 20 dos 21 casos do estrato A:
**sobrou um caso de margem**. O harness detecta regressão e não detecta melhoria.

Portanto esta auditoria **não promete ganho de acurácia**, porque o instrumento não conseguiria
comprovar. O que ela entrega é mensurável e material:

- **Custo.** O system prompt tem ~2.030 tokens e domina cada chamada. Retirar as duplicações
  deve remover na ordem de 700 tokens de toda chamada, para sempre — cerca de 35% do input.
  Sobre os R$ 8,30 por clínica/mês do classificador, é redução direta.
- **Latência.** Menos tokens de entrada, menos tempo até a primeira resposta útil, que tem meta
  de p95 abaixo de 15 s.
- **Manutenibilidade.** Uma decisão com um dono é auditável; com dois, o comportamento depende
  de ordem de execução e ninguém consegue prever o efeito de editar um dos lados.

O papel do eval passa a ser **trava de segurança**: provar que a acurácia não caiu enquanto o
custo cai. Se a spec 1 entregar resolução suficiente, ganho de acurácia volta a ser detectável
e é registrado como bônus, não como promessa.

## 4. Estrutura: índice por decisão, varredura por linha como completude

**Índice por decisão** é a estrutura principal. Duplicação é uma **relação entre dois lugares**;
uma lista linha a linha não a revelaria, porque cada linha isolada parece legítima.

**Varredura linha a linha é o teste de completude.** Toda linha de regra do classificador e do
composer precisa mapear para exatamente uma decisão do inventário. Linha que não mapeia é
marcada como **órfã** e investigada: ou é decisão que ninguém catalogou, ou é regra morta.

**Incidentes reais definem a ordem de ataque.** Decisão implicada em bug conhecido vem antes
de decisão suspeita por leitura.

### 4.1 Formato do inventário

`docs/architecture/decision-ownership.md`, uma linha por decisão:

| Campo | Conteúdo |
| --- | --- |
| `id` | identificador estável, ex. `D-014` |
| pergunta | a pergunta que a decisão responde, em uma frase |
| onde é decidida | referências de arquivo e linha: regra de prompt, função de guard, ou ambos |
| dado exigido | o que precisa ser conhecido para decidir: catálogo, escala, estado de pipeline, nada |
| dono correto | `código` quando a decisão é consulta a dado; `LLM` quando é julgamento linguístico |
| donos hoje | quantos, e quais |
| evidência de dano | incidente real, caso do eval, ou "nenhuma conhecida" |
| ação | manter · retirar do prompt · mover para código · excluir (regra morta) |

O critério de dono é único e mecânico: **se a decisão exige consultar dado que o sistema possui,
o dono é código.** Se exige interpretar linguagem, o dono é a LLM. Manutenção fora de catálogo é
o exemplo canônico: "isso é pergunta de preço?" é linguagem, "esse serviço está no catálogo?" é
consulta — e a regra do prompt erra por pedir as duas juntas.

## 5. Escopo

**Dentro:**

- Prompt do classificador (`src/core/intelligence/IntentClassifier.ts`).
- Prompt do composer (`src/core/intelligence/ResponseComposer.ts`).
- Fragmentos de contexto injetados por virada — as funções `build*Context` do orquestrador,
  que compõem parte do prompt efetivo e são hoje o pedaço menos visível da superfície.
- As 62 funções determinísticas do orquestrador e de `conversation-response-parts.ts`.
- `FieldComposer.ts` e `PlaybookAdvisor.ts`, que têm poucas instruções mas entram na varredura
  para o teste de completude valer.

**Fora:**

- Pipeline assíncrono, canais, outbox, entrega.
- Persistência, exceto leitura como fonte de verdade.
- TTS, calendário, storage, notificações, Sentry.
- Qualquer alteração de schema — vai para a spec 4.

## 6. Como cada retirada é validada

Uma retirada por PR. Nunca em lote: se três retiradas entrarem juntas e a acurácia cair, não se
sabe qual delas causou.

**Decisão do classificador** → `npm run eval:intent -- --repeat 3`. Critério: zero aumento de
falha crítica ou alta; contagem de tokens do prompt reportada antes e depois.

**Decisão do composer** → `npm run eval:prose` (spec 2), comparando antes e depois. Critério:
o judge não pode preferir a versão anterior em mais pares do que a nova, descontados os empates.

**Onde nenhum dos dois cobre** → a retirada **não acontece**. A conclusão registrada é "sem
instrumento para validar", e a decisão fica no inventário como pendente. Retirar regra sem
medição é o mecanismo que criou este problema; repeti-lo com aparência de método seria pior do
que não fazer.

## 7. Verificação

1. O inventário existe e toda decisão tem os oito campos preenchidos — nenhum "a definir".
2. Teste de completude: toda linha de regra do classificador e do composer mapeia para uma
   decisão, ou está marcada como órfã com justificativa.
3. As cinco duplicações conhecidas aparecem no inventário com `donos hoje = 2`.
4. Cada retirada executada tem PR próprio, com a medição no corpo do PR.
5. Contagem de tokens do prompt do classificador antes e depois de toda a auditoria, com a
   redução percentual registrada.
6. `npm run verify` verde em cada PR.
7. Nenhuma retirada de guard determinístico. Esta auditoria retira **regra de prompt**; guard
   sai apenas por spec própria, com evidência própria.

## 8. Riscos

- **O inventário fica desatualizado.** Um documento que descreve código divergindo do código é
  pior que nenhum documento. Mitigação: o inventário referencia arquivo e linha, e a auditoria
  produz um script de checagem que falha quando uma referência aponta para o vazio.
- **Retirada silenciosamente prejudicial.** O eval detecta regressão nos casos que tem, não em
  todos os casos possíveis. Um caso não coberto pode piorar sem alarme. Mitigação: retirada uma
  por uma, e a spec 1 aumentando a cobertura antes.
- **Tentação de refatorar de passagem.** A auditoria toca 8.349 linhas de orquestrador e vai
  encontrar coisas feias que não são duplicação de decisão. Elas são anotadas e não corrigidas
  aqui.
- **Resolução insuficiente.** Se a spec 1 não atingir a meta, esta auditoria fica limitada a
  "não piorou" em todas as conclusões de classificador. Isso é aceitável e deve ser dito no
  relatório, não escondido.

## 9. Entregáveis

1. `docs/architecture/decision-ownership.md` — o inventário, artefato durável.
2. Um script de checagem de referências do inventário, rodável no CI.
3. Uma sequência de PRs de retirada, cada um com medição.
4. Um relatório final com: tokens antes e depois, decisões com dono corrigido, decisões
   deixadas pendentes por falta de instrumento, e as órfãs encontradas.
