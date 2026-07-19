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
