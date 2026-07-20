# 06 — Mapeamento de falhas conversacionais — noite de 18/07 (leads reais Vitalli)

> Registro para correção coordenada. Cada defeito tem evidência real, causa raiz
> verificada no código (arquivo:linha) e correção proposta. Objetivo: corrigir em
> ordem, sem sobreposição e sem regressão — um PR por grupo coeso.

## Estado dos deploys no momento do mapeamento (18/07 ~21:45 BRT)

| Item | Status |
| --- | --- |
| PR #196 — fix do gate de 8 palavras (opener de anúncio → saudação + pipeline) | **MERGED + em produção** (~20:50) |
| PR #197 — botão Pipeline arma trilho + replay (`start_pipeline_rails`) | **ABERTO**, aguardando merge |
| Itens T1/T2 abaixo | Mapeados, sem PR |

---

## Caso Nathan (21:29–21:32) — duplicação answer-first

**Evidência:** lead responde à saudação com "quero entender um pouco mais como
funciona e valores também". A IA envia (1) explicação longa em prosa — técnicas,
personalização **e valores R$ 1.700/2.000 em texto livre** — e em seguida (2) o
conteúdo curado do pipeline ("Nós somos especialistas..." + cards de valores),
repetindo tudo.

- **N1 — Answer-first responde o que o conteúdo curado já responde.**
  - Causa raiz: na continuação do pipeline
    ([ConversationOrchestrator.ts:4771-4807](../../../../src/core/pipeline/ConversationOrchestrator.ts)),
    o motor compõe `general_question` com a instrução "responda a dúvida atual;
    depois o sistema envia o conteúdo" — a LLM não sabe o que o conteúdo cobre e
    explica o tratamento inteiro (inclusive preço em prosa, burlando a intenção
    dos cards). `buildAnswerFirstPipelineContent` (linha ~2082) concatena os dois.
  - Correção proposta (2 pontos):
    1. Curto-circuito determinístico: se a mensagem do lead é interesse genérico
       no tratamento do pipeline ("quero saber mais", "como funciona",
       "ver valores", menção ao tratamento sem pergunta específica) → **pular a
       LLM** e enviar só o conteúdo curado. O conteúdo É a resposta.
    2. Nos casos legítimos de answer-first (pergunta específica: bruxismo,
       parcelamento, endereço): instrução explícita "NÃO descreva o tratamento
       nem cite valores — a apresentação com valores segue abaixo; 1–2 frases só
       sobre o que a apresentação não cobre".
  - Prioridade: **P0** (toda conversa nova de anúncio passa por aqui).

---

## Caso João Vitor Dantas (11:36–21:38) — 7 defeitos encadeados

Linha do tempo: opener de anúncio 11:36 (IA desligada de tarde) → recuperação
genérica 17:10 → "Boa noite pode sim" 21:33 → re-saudação Gleice → "Valores e
onde é o consultório" 21:35 → prosa sem preço → "20 lentes" + "Queria ver um
pouco do trabalho de vocês" 21:36 → markdown quebrado + CTAs sem contexto.

- **J1 — Recuperação genérica cria segunda persona.**
  - Evidência: msg de 17:10 ("Que bom que você está interessado... Posso te
    ajudar com informações") sem Gleice, sem nome do lead, sem conduzir; às
    21:33 a Gleice "se apresenta" como se nada tivesse acontecido.
  - Causa raiz: o fluxo de recuperação
    ([recovery-actions.ts](../../../../src/app/(clinic)/app/inbox/recovery-actions.ts))
    usa um mini-LLM próprio (gpt-4o-mini, prompt isolado), fora do Orchestrator
    e da persona. Relacionado à memória "persona-config-drift".
  - Correção proposta: recuperação deve sair pelo motor (mesma mecânica de
    replay do PR #197: armar contexto + reprocessar a última msg do lead) ou, no
    mínimo, usar persona/saudação consistentes. Prioridade: **P1**.

- **J2 — Re-saudação engole o aceite do lead.**
  - Evidência: lead respondeu "Boa noite pode sim" (aceite da oferta da
    recuperação) e recebeu o starter da Gleice de novo, sem entregar nada.
  - Causa raiz: gap de 4h+ marca a conversa como stale
    ([ConversationOrchestrator.ts:3347-3353](../../../../src/core/pipeline/ConversationOrchestrator.ts),
    `staleConversationHours` default 4) e o branch
    `isStaleConversation && (greeting|acknowledgment|unclear)` (linha 3928-3938)
    reenvia o concierge starter — ignorando que a última msg do agente era uma
    OFERTA aberta ("posso te ajudar?") e que "pode sim" é resposta a ela.
  - Correção proposta: antes do branch stale, checar se a última msg do agente é
    uma oferta/pergunta aberta e a msg do lead é afirmativa curta ("pode",
    "sim", "quero", "pode sim") → tratar como aceite (seguir o fluxo da oferta),
    não como saudação. Prioridade: **P1**.

- **J3 — Pergunta composta "Valores e onde é o consultório": preço evapora.**
  - Evidência: resposta deu o endereço e prosa vaga ("o investimento varia...")
    sem nenhum valor nem card.
  - Causa raiz: o guard de localização (`directLocationRequested`,
    [linha 4843](../../../../src/core/pipeline/ConversationOrchestrator.ts))
    captura a mensagem e os caminhos de preço/pipeline são excluídos quando ele
    está ativo (linhas 4907, 4992, 5133). Pedido composto perde a metade
    comercial.
  - Correção proposta: quando localização vem junto de pedido de preço
    (`isPriceRequestText` na mesma mensagem), responder endereço E disparar o
    conteúdo/valores do pipeline no mesmo turno. Prioridade: **P1**.

- **J4 — "20 lentes" (preço por quantidade) ignorado.**
  - Evidência: lead especificou a quantidade e nunca recebeu o valor do pacote
    de 20; o turno respondeu apenas a mensagem seguinte ("ver trabalho").
  - Causa raiz: debounce agrega o burst, mas a composição respondeu só o último
    tema; o resolver de quantidade (PR #193, `quantityPriceResolution`) não foi
    acionado no caminho que respondeu.
  - Correção proposta: no turno agregado, se alguma mensagem do burst contém
    quantidade + contexto de preço aberto, a resposta DEVE incluir o valor exato
    do pacote (tabela fechada) antes de tratar o segundo tema. Prioridade: **P1**.

- **J5 — Markdown de mídia vazado no WhatsApp.**
  - Evidência: texto cru enviado ao lead:
    `![Cores](https://media.5d383eb4-7dce-4fe3-a14a-5fad569fe6a7)` precedido de
    "Aqui está a imagem:" — e nenhuma imagem anexada.
  - Causa raiz: a LLM inventou sintaxe markdown com pseudo-URL contendo o id do
    asset, em vez do token `[MEDIA:id]`. A sanitização
    ([ResponseComposer.ts:206-233](../../../../src/core/intelligence/ResponseComposer.ts),
    `normalizeTextReplyContent`) cobre `[VÍDEO]`, `**bold**` e conectivos órfãos,
    mas NÃO cobre `![...](...)` nem links markdown.
  - Correção proposta (defesa em profundidade):
    1. Regex de resgate: `![...](...uuid...)` cujo uuid existe na biblioteca →
       converter para `[MEDIA:uuid]` (a mídia é entregue de verdade).
    2. Caso contrário → remover a sintaxe inteira + frases órfãs do tipo "aqui
       está a imagem" imediatamente antes.
  - Prioridade: **P0** (texto quebrado visível para lead real).

- **J6 — "Queria ver o trabalho de vocês" sem entrega + resposta duplicada.**
  - Evidência: dois turnos seguidos (21:37 e 21:38) começando "Entendo...",
    ambos prometendo casos de sucesso, nenhum anexando os assets de resultado
    que existem na biblioteca (Resultado Técnica Premium/Estratificada).
  - Causa raiz: (a) burst de 2 msgs virou 2 turnos quase idênticos (relacionado
    a T1); (b) o pedido "ver trabalho/casos/antes e depois" não tem rota
    determinística para os assets de resultado — fica a cargo da LLM, que
    promete e não entrega.
  - Correção proposta: mapear intenção "ver casos/trabalho/resultados" →
    anexar deterministicamente os assets de resultado do tratamento em contexto.
    Prioridade: **P1**.

- **J7 — CTA compulsivo de avaliação/foto sem sinal do lead.** *(apontado pelo
  Brendon — faz o cliente fugir)*
  - Evidência: 21:35 termina com "Que tal agendarmos uma avaliação?"; 21:37
    idem + cores; 21:38 pede foto do sorriso — três CTAs em sequência sem o lead
    ter sinalizado intenção de agendar, e ignorando as perguntas reais dele.
  - Causa raiz: instruções do composer em modo concierge mandam "conduza
    ativamente para o próximo passo — não espere o lead pedir"
    ([ResponseComposer.ts:739 e 750](../../../../src/core/intelligence/ResponseComposer.ts))
    em TODA resposta; não existe freio entre turnos (nenhuma checagem de "o CTA
    anterior foi ignorado/recusado").
  - Correção proposta (recalibrar, não remover — princípio "o sistema decide, a
    LLM verbaliza"):
    1. Gate determinístico de CTA: só permitir fechamento com
       avaliação/agenda/foto quando (a) o lead deu sinal de intenção (pediu
       preço E reagiu positivamente, perguntou "como agendo", etc.) ou (b) o
       playbook/pipeline estiver num passo que peça isso.
    2. Anti-repetição: se o turno anterior do agente terminou com o mesmo CTA e
       o lead não reagiu a ele, o turno atual NÃO repete — responde a pergunta e
       para.
    3. Pedido de foto: só no passo de foto do pipeline, nunca como fechamento
       genérico de general_question.
  - Prioridade: **P0** (dano comercial direto; motivo de fuga apontado na
    validação com lead real).

---

## Caso teste SystemOps 22:18 — J8

- **J8 — Pedido de foto acoplado a resposta de descoberta no passo de Q&A.**
  - Evidência: lead pediu "me mostra as cores"; resposta veio correta (explicação
    + tabela de cores por keyword), mas o pedido de foto + exemplo de ângulos
    veio grudado no mesmo turno — pergunta de descoberta tratada como prontidão.
  - Causa raiz: no passo `qa`, o anexo do próximo conteúdo disparava com
    `keywordMediaId || afirmativa || conteúdo-de-foto pendente` — na prática, a
    instrução de foto se acoplava à primeira resposta de Q&A, qualquer que fosse.
  - Correção: `canAppendQaFollowUpContent` — instrução de foto só anexa com
    afirmativa curta do lead (prontidão); sem sinal, o Q&A permanece aberto e o
    passo de foto pede na vez dele (fim dos qaTurns). Conteúdo comum mantém os
    momentos de ritmo (keyword/afirmativa). A pausa de Q&A que se cogitou criar
    JÁ EXISTE (passo `qa` + `maxTurns`) — não foi preciso adicionar fricção.
  - Status: **IMPLEMENTADO 18/07 ~22:25** (branch `fix/qa-photo-append-readiness`).

## Transversais já mapeados (conversa de teste SystemOps 20:52)

- **T1 — Mídia fura o debounce de burst.** Caminho de mídia responde imediato e
  retorna antes do debounce ([ConversationOrchestrator.ts §3.7](../../../../src/core/pipeline/ConversationOrchestrator.ts));
  texto+imagem em sequência viram 2 turnos intercalados. Correção: mídia entra
  na agregação do burst. Prioridade: **P1**. (Também contribui para J6.)
- **T2 — Janela estreita de detecção de criativo de anúncio.**
  `resolveAdMediaContext` exige zero respostas do agente + ≤3 msgs; criativo
  encaminhado APÓS a saudação vira "foto clínica" e pula o funil (foto errada no
  passo de foto). Correção: janela por burst/idade da conversa (≤4-5 msgs, ≤2min
  da msg-opener), mesmo com saudação já enviada. Prioridade: **P1**.

## Resolvidos aguardando merge (PR #197)

- Botão Pipeline despejava pacote inteiro sem pacing → agora arma trilho +
  replay da última msg do lead (a IA conduz passo a passo).
- `hasPipelineContentStepBeenSent` não contava `clinic_user` → conteúdo enviado
  manualmente pela operação não é mais repetido pelo motor.

## Ordem de execução sugerida

1. **PR A (P0, imediato):** N1 (duplicação answer-first) + J7 (gate de CTA) +
   J5 (sanitização markdown). São os três que estão queimando leads agora.
   → **IMPLEMENTADO em 18/07 ~22h** na branch `feat/pipeline-rails-button`
   (PR #197), junto com o trilho do botão Pipeline:
   - N1: `isGenericTreatmentInterestMessage` + curto-circuito na continuação
     (conteúdo curado sem prosa LLM) + instrução endurecida no answer-first
     restante (máx. 2 frases, sem descrever tratamento/valores, sem CTA).
   - J7: `shouldSuppressNextStepCta` + `collectPreviousAgentTurnBodies` no
     Orchestrator; flag `suppressNextStepCta` no Composer troca a condução
     ativa por "REGRA DE RITMO — CTA JÁ FEITO" em price_inquiry e
     general_question. CTA de operador ignorado também conta.
   - J5: `rescueMarkdownMediaSyntax` no Composer antes do parse — uuid válido
     vira `[MEDIA:id]` (mídia entregue de verdade), o resto é removido junto
     com frases-promessa ("Aqui está a imagem:").
   - Testes: `ConversationRhythmGuards.test.ts` (17 casos, cenários reais
     Nathan/João Vitor).
2. **PR B (P1):** J2 (aceite pós-stale) + J3 (pergunta composta) + J4
   (quantidade no burst).
3. **PR C (P1):** T1 (mídia no debounce) + T2 (janela de criativo) + J6 (rota de
   casos de sucesso).
4. **J1 (recovery com persona):** depois do merge do PR #197, reusar o replay.

→ **WAVE 2 IMPLEMENTADA em 19/07** na branch `feat/conversation-quality-wave2`
(todos os itens acima):
- J2: `isAffirmativeReplyToOpenOffer` — afirmativa curta após oferta aberta
  coage para general_question (entrega a oferta) e, quando a oferta menciona o
  tratamento, abre o pipeline (`hasExplicitPipelineTreatmentTrigger`).
- J3: localização + preço na mesma mensagem → endereço determinístico + cards
  do pipeline no mesmo turno (fallback: contexto combinado obrigatório).
- J4: `collectCurrentLeadBurstBodies` + `resolveQuantityPriceQuery` no burst —
  valor exato do pacote abre a resposta deterministicamente.
- T1: `mediaReplySuperseded` — mídia respeita a janela de debounce nos 3 pontos
  de resposta (humanReview, intercept de pipeline, mídia genérica); efeitos de
  estado (pausa/atenção/notificações) preservados.
- T2: `resolveAdMediaContext` agora bloqueia por "equipe pediu foto"
  (`hasAgentRequestedPhoto`) e conversa madura (>5 msgs), não por "IA já
  respondeu" — criativo pós-saudação volta a ser reconhecido.
- J6: `isShowcaseRequestText` + `pickShowcaseMedia` — pedido de casos anexa
  mídias de resultado deterministicamente (máx. 2, escopo do tratamento).
- J1: rota `/api/conversations/[id]/recover` — retomada pelo motor via replay
  (persona única); modal do Inbox ganhou "Retomar com a IA agora" com o
  rascunho manual como fallback.
- Testes: `ConversationWave2Guards.test.ts` (13 casos) +
  `AdMediaDetection.test.ts` reescrito para a nova semântica (8 casos).

### Replay real (19/07, branch Neon `replay-wave2-19-07`, driver `scripts/replay-wave2-guards.ts`)

Caminho idêntico ao de produção (webhook → worker → Orchestrator → outbox),
`DISABLE_REAL_WHATSAPP_SEND=true`. Resultados:

| Cenário | Resultado |
| --- | --- |
| A — N1 Nathan (interesse genérico) | ✅ saudação → conteúdo curado, zero prosa duplicada |
| B — J2 "Boa noite pode sim" | ✅ (após fix do confirm_slot incluir o passo atual) entrega a apresentação, sem re-saudação |
| C — J3 valores + endereço | ✅ endereço determinístico + cards no mesmo turno |
| D — J4×J6 burst "20 lentes" + vitrine | ✅ linha determinística "Sobre o pacote de 20: R$ 2.500/2.000" + prosa LLM limpa de números (scrub com remoção de anúncio órfão) |
| E — T1+T2 criativo pós-saudação | ✅ um turno único, sem "Recebi sua foto", sem encavalamento |
| F — J8 cores → prontidão | ✅ cores só com a tabela; pedido de foto apenas após "sim pode" |

Descobertas do replay que viraram ajuste extra:
- `confirm_slot` sem oferta pendente pulava o passo de conteúdo ATUAL não
  enviado (ia direto ao pedido de foto) — corrigido para incluir o passo atual.
- Instrução "não cite valores" não segura o gpt-4o-mini —
  `stripPriceProseWhenSystemQuoted` remove parágrafos com R$ e anúncios órfãos
  da prosa quando o sistema já cotou.

**Gap de CONFIG (não é código):** a biblioteca da Vitalli não tem nenhum asset
de "Resultado/antes e depois" para lentes (só Cores, Cuidados, Exemplo Foto,
Valores; o único antes/depois é da Plástica Gengival). A rota J6 está pronta —
quando os assets de resultado forem cadastrados, a vitrine passa a ser entregue
automaticamente. **TODO para o Victor/Brendon: subir 2-3 imagens de resultado
de lentes na biblioteca.**

## Próximo caso (aguardando envio do Brendon)

_Reservado — outro erro em andamento com lead real será adicionado aqui._

## Wave 3 — defeitos das conversas reais de 19/07 manhã (últimas 5h)

Análise de 17 conversas reais (`vitalli-last-5h.json`). Evidências confirmaram
os fixes da wave 2 em leads reais (Gabii=J2, ADRIANA=J3, Felipe=N1) e revelaram
4 defeitos novos — **implementados e validados por replay em 19/07 ~13:30**
(commit na branch `feat/conversation-quality-wave2`, PR #200):

- **W3.1 (Lineeh, P0 conversão):** "Quero valores, formas de pagamento e fazer
  uma avaliação" respondia SÓ o sinal de R$ 30 → agora cards de valores.
- **W3.2 (Irys):** endereço parafraseado sem número/sala + "nova localização"
  inventada → endereço determinístico completo.
- **W3.3 (Henrique):** "dúvidas sobre o procedimento" despejava catálogo de 26
  itens → conteúdo do tratamento em contexto.
- **W3.4 (Felipe):** "Ambas" → direto ao conteúdo curado, sem prosa antes.

Observação candidata a wave 4: preço em prosa no caminho general (caso ST 💜 —
"é esse valor de 2k mesmo?" respondido com todos os valores em texto; cards
seriam melhores).

## Travas de funil OPERACIONAIS detectadas em 19/07 (ação humana, não código)

- **Amanda (5511983875558):** pediu "Simular 21x" em 18/07 08:33 — sem resposta
  há 28h+, conversa pausada ("Operador acionou atendimento especializado").
- **Giuliana (5511961908480):** enviou foto de pré-avaliação 19/07 04:49 —
  equipe ainda não retornou.

## Wave 4 — contexto do operador + preço em prosa (19/07 noite, código de prod b2063c3)

Verificada contra o código REAL de produção e validada por replay (branch Neon fresco). Commit na branch `feat/conversation-quality-wave4`.

- **W4.1 (Lineeh — "avaliar por aqui" → foto): JÁ ESTAVA EM PRODUÇÃO.** `isRemotePreEvaluationRequest` detecta "avaliar/análise + por aqui/whatsapp/mandar foto" e emenda o bloco de instrução de foto. Nada a fazer.
- **W4.2 (ST — preço vira prosa no caminho geral):** pergunta de preço que o classificador rotula `general_question` ("é esse valor de 2k mesmo?") agora recebe os CARDS curados de valores (emenda, sem descartar as partes compostas de avaliação/agendamento; prosa de R$ é limpa). `isPriceShapedIntent` já existia; faltava rotear no caminho geral.
- **W4.3 (Paula — IA cega ao operador, CRÍTICO):** `lastAgentMessage` só lia `author==="agent"`, ignorando o operador. Quando o operador ofertava um horário para o PROCEDIMENTO e o lead confirmava, a IA revertia a "avaliação presencial é o primeiro passo", contradizendo o operador. Novo `lastSlotOfferWasByOperator` + guard `operatorManagedBooking`: se a última oferta concreta de horário foi do operador e não há oferta do sistema pendente, o lead confirmando roteia para pausa+alerta (aceno caloroso determinístico), devolvendo o controle ao operador.
- **W4.3b (Paula — horário duplicado):** resposta determinística de horário de atendimento não reenvia se idêntica à última do agente há < 2min (burst que furava o debounce).

Replay 19/07 (branch `replay-wave4-19b`, driver `scripts/replay-wave4-guards.ts`):
- Paula ✅ → "Perfeito! Vou confirmar esse horário com a nossa equipe..." + aiPaused + alerta; sem "avaliação presencial".
- ST ✅ → resposta curta de avaliação/agendamento + cards Premium/Estratificada (sem valores em prosa).

## Etapa de fechamento acionável (20/07) — sinal no atendimento manual

**Problema (caso Paula):** quando o operador assume o agendamento no braço, ele
perde todo o maquinário de sinal. O caminho manual (`register-appointment` +
copiar/colar a mensagem do Pix) **não engata a máquina de estado do depósito**,
então o comprovante do lead não é reconhecido: não dispara os botões de validação
do responsável, não abre o `DepositBanner` e não gera a confirmação/liberação
automática. Na Paula isso ainda causou erro de data no copiar/colar.

**Solução (config-driven, sem nada específico de clínica):** a etapa `book` do
pipeline — que já existia na config e era inerte ("Etapa automática") — virou
**acionável** no mesmo painel de pipeline que já lista as etapas da empresa.

- `listGuidedPipelineSections(steps, { depositEnabled })` → a etapa `book` ganha
  `mode: "schedule"` e rótulo "Reservar horário e pedir sinal" **apenas quando a
  clínica cobra sinal**; sem isso segue automática, como antes.
- `POST /pipeline-actions` com `stepIndex` da etapa `book` + `date`/`time`:
  reserva o horário **PROVISORIAMENTE** (`SlotReservationService`, TTL do sinal),
  grava `startDepositWait` com o payload completo e envia o
  `buildDepositRequestMessage` da própria clínica. Nunca cria agendamento efetivo
  — a efetivação continua sendo só após a validação do Pix. Falha depois da
  reserva libera o slot para não travar a agenda.
- Valores (Pix, valor, TTL, observações) vêm da config da organização; qualquer
  clínica com `deposit_enabled` ganha, sem código novo.

**Replay end-to-end (branch Neon isolado):** operador aciona a etapa → rota
retorna `deposit_requested` (Sáb 25/07 às 16h), reserva fica `pending`, estado
`awaiting_deposit_proof`, lead recebe o pedido de sinal → lead envia comprovante
→ estado `deposit_proof_received` + atenção "validar Pix P3" (botões do
responsável disparados) + "Recebemos seu comprovante!" ao lead. ✅
