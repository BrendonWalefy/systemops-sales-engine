# Handoff — Execução do Plano de Excelência Conversacional

**Atualizado**: 04/07/2026 · **Sessão**: execução iniciada pelo Claude (Fable) a pedido do dono.
**Plano-mãe**: `docs/product/plano-excelencia-conversacional.md` · **Auditoria**: `docs/product/auditoria-conversacao-2026-07.md`

## Instruções do dono (obrigatórias)

1. **Entrega única**: NÃO fazer PRs fatiados. Finalizar tudo em UMA branch, UM PR
   consolidado, subir para `develop` e `main` uma única vez. (Memória: PRs vão para
   `main`; develop está defasada — AGENTS.md §Stable Production Rule está desatualizado
   nesse ponto.)
2. **Gate antes de subir**: rodar replay com as perguntas REAIS dos leads da Ximendes
   (ou similares) contra a IA REAL de produção (OpenAI de verdade, mesmo pipeline
   classificador→guards→composer) e avaliar se o tom está no nível das conversas curadas
   da demo (`src/application/demo/demo-conversation-scripts.ts`). Deve valer para
   qualquer clínica nova, não só Ximendes.
3. **Estratégia de preenchimento**: o dono pediu orientação de como induzir clientes a
   preencher as configurações sem bloquear (Ximendes se confunde com a ferramenta).
   Resposta em `docs/product/estrategia-preenchimento-config.md` (criar se não existir).

## O que JÁ EXISTIA no código (não retrabalhar — descoberto na sessão)

| Item do plano | Status | Onde |
|---|---|---|
| P0.1 Guard anti-saudação-genérica | ✅ feito | `coerceBusinessIntent` em `ConversationOrchestrator.ts:553` (greeting/ack/unclear → price_inquiry/patient_arrived/general_question) |
| P0.2 Quiet hours follow-up | ✅ feito | `timezone.isWithinContactWindow(now)` no `follow-up-dispatcher/route.ts:277` |
| P0.3 Debounce de rajada | ✅ parcial | `ConversationOrchestrator.ts:1706` (5s, só a última msg do burst responde, com histórico completo) |
| F9 artefatos `[VÍDEO]` literais | ✅ feito | `MEDIA_LABEL_ARTIFACT_RE` em `ResponseComposer.ts:114` |
| F8 patient_arrived determinístico | ✅ feito | `detectPatientArrivalText` + coerce em `ConversationOrchestrator.ts:540` |

## ✅ CONCLUÍDO nesta sessão (04/07/2026) — tudo implementado e testado

Todos os 6 itens do escopo abaixo foram implementados, com testes passando (44 testes
nos arquivos afetados) e o **replay rodado com a IA REAL contra o playbook real da
Ximendes: todos os checks determinísticos verdes** — coerção de intent funcionando,
preço com âncora + degrau da avaliação, acolhimento antes de argumento (caso noiva).
Docs criados: `manual-voz-atendimento.md`, `estrategia-preenchimento-config.md`.

**Achado do replay:** objeção de preço com âncora social ("minha amiga fez por menos")
classificava como `needs_human` e a resposta de handoff era fraca ("a equipe irá
responder em breve"). A resposta ao lead foi corrigida nesta branch: quando
`handoff_requested` tem motivo comercial/preço, o composer valida a objeção, reancora
o valor e oferece o degrau da avaliação antes de mencionar a equipe. Ainda fica como
backlog o radar de fechamento no Inbox (P2.13).

## Escopo DESTA entrega (estado no fim da sessão — conferir git status/diff)

1. **F4 restante — supressão de follow-up com operador ativo** (`follow-up-dispatcher/route.ts`
   + função pura em `follow-up-dispatch-policy.ts` + teste):
   - Em `processOneFollowUp`, após buscar a conversa: se `conv.aiPaused` OU última
     mensagem é de `clinic_user` há menos de 12h → reverter follow-up para `pending`
     (des-claim) e retornar "skipped". A conversa query (linha ~111) precisa selecionar
     `aiPaused` também; buscar última mensagem (author, sentAt, limit 1 desc).
   - Função pura testável: `shouldSuppressFollowUpForOperatorActivity({ aiPaused,
     lastMessageAuthor, lastMessageSentAt, now })` em `follow-up-dispatch-policy.ts`.
2. **F9 restante — higiene de saída** (`ResponseComposer.ts` + `ParseIntoParts.test.ts`):
   - `**negrito**` → `*negrito*` (WhatsApp) em `normalizeTextReplyContent`.
   - Conectivos órfãos pós-extração de mídia em `normalizeResponseParts`: dropar parte
     de texto que só tem conectivo/pontuação ("e", "e .", "."); strip de "e"/"ou"
     pendurado no fim de parte que precede mídia; strip de pontuação órfã no início de
     parte que segue mídia. Cuidado para NÃO remover "E se preferir..." legítimo.
3. **Fase 3 — arco de persuasão no composer** (`buildSystemPrompt` em `ResponseComposer.ts`):
   - Seção "COMO CONDUZIR" com o arco acolher→responder→provar→avançar + espelhamento
     de registro + preço com degrau de baixo compromisso (ver plano §2, as 7 técnicas).
   - 3 exemplares universais de tom (medo, objeção de preço, "vou pensar") SEM dados de
     clínica — comportamento universal vive no prompt (AGENTS.md §Sources of Truth).
   - Bump `PROMPT_VERSION` para `"composer-v4-demo-quality"`: arco + padrão demo
     (calor, prova concreta, fechamento ativo) e guarda contra provas não cadastradas
     como "casos anteriores" ou "simulação" quando não existem no playbook/mídia.
4. **Modelo do composer por plano + env** (Fase 5):
   - `OPENAI_COMPOSER_MODEL` força todos os planos no replay/A/B.
   - Sem override global: Start (`essencial`) usa `gpt-4o-mini`; Growth (`avancado`),
     Scale (`rede`) e `custom` usam `gpt-5.5` no `ResponseComposer`.
   - Overrides finos: `OPENAI_COMPOSER_MODEL_START`, `OPENAI_COMPOSER_MODEL_GROWTH`,
     `OPENAI_COMPOSER_MODEL_SCALE`, `OPENAI_COMPOSER_MODEL_CUSTOM` ou
     `OPENAI_COMPOSER_MODEL_PREMIUM`.
   - GPT-5.x usa Responses API no composer; modelos antigos seguem no Chat Completions.
   - `cost-estimator.ts` já precifica `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-5.4-mini`,
     `gpt-5.4` e `gpt-5.5`. Ao testar outro modelo, adicionar em `AI_MODEL_PRICES`.
   - O `IntentClassifier` continua com `OPENAI_CLASSIFIER_MODEL` e fallback
     `gpt-4o-mini`; regra vigente: manter mini + guards até benchmark provar necessidade.
5. **Harness de replay** (`scripts/replay-conversas.ts`, npm script `replay:conversas`):
   - Roda o pipeline real (IntentClassifier → coerceBusinessIntent → ação → Composer),
     como `generate-demo-conversation.ts` faz, com o editorial config de uma clínica
     (por slug, default Ximendes) OU um playbook local de fixture.
   - Casos: as falhas reais da auditoria (Tania "Posso ter mais informações sobre
     custo?", Julllys "E qual seria os valores?", Carla "estou aqui na frente mas
     ninguém atende", Hellen "quanto custa o contorno nos 4 dentes da frente?",
     Tarcisio "Não é lentes, quero saber de prótese", Jean "polimento", "achei um pouco
     caro", "vou pensar e te falo", "meu casamento é em outubro, dá tempo?").
   - Output: conversa impressa para avaliação de tom + asserts determinísticos
     (intent coagido certo; resposta não é saudação genérica; preço presente quando a
     política autoriza).
   - Requer `OPENAI_API_KEY` (usar `.env.local` — `DISABLE_REAL_OPENAI` NÃO pode estar
     true). NÃO grava no banco — só compõe.
6. **Docs**: `docs/product/manual-voz-atendimento.md` (destilar §2 do plano com
   exemplos bons/ruins por situação) + `docs/product/estrategia-preenchimento-config.md`
   (ver seção abaixo) + atualizar checkboxes de status no plano-mãe.

## Estratégia de preenchimento de config (resposta ao dono — essência)

Ximendes não vai parar para preencher formulário. A coleta tem que ir até ela:

1. **Caixa de perguntas não respondidas** (prioridade 1): o sistema já detecta treatment
   gaps. Transformar em inbox de pendências no dashboard: "5 leads perguntaram preço de
   manutenção este mês — responda UMA vez e a IA responde para sempre". Uma pergunta por
   vez, com a mensagem real do lead como contexto, campo único, salvar → vira política.
2. **Capturar correção do operador** (prioridade 2): quando o operador responde no inbox
   algo que a IA não sabia (caso Hellen R$250/dente), oferecer 1-clique "ensinar isso à
   IA" → adiciona à política comercial (com revisão/publish normal).
3. **Medidor de completude** no dashboard (não bloqueia): "Sua IA sabe X% do que precisa
   para vender" com as 3 lacunas de maior impacto e link direto pro campo certo. Conecta
   com o checklist de publish já existente (bloqueio de R$ na descrição, PR #122).
4. **Onboarding conversacional**: a própria IA entrevista o dono (no simulador ou
   WhatsApp): "Quanto custa a avaliação? Parcela em quantas vezes?" — 10 min, sem
   formulário, e o dono aprende como a IA conversa. Conecta com o onboarding comercial
   guiado já em andamento (`docs/product/onboarding-comercial-guiado-handoff.md`).

Ordem de valor: 1 e 2 capturam dado no fluxo real (zero fricção); 3 dá visibilidade;
4 resolve o primeiro preenchimento de clínica nova.

## Fluxo de entrega (quando o código estiver pronto)

```bash
npm run verify                          # obrigatório (AGENTS.md)
npx vitest run src/__tests__/ParseIntoParts.test.ts src/__tests__/FollowUpDispatchPolicy.test.ts  # novos
npx tsx scripts/replay-conversas.ts     # GATE do dono: avaliar tom vs demo curada
git checkout -b feat/excelencia-conversacional
# commits pequenos: (1) follow-up suppression, (2) higiene saída, (3) prompt arco,
# (4) MODEL env, (5) harness replay, (6) docs
gh pr create --base main ...            # UM PR só
# após merge: git checkout develop && git merge main && git push (sincronizar develop)
```

## Fora desta entrega (backlog, em ordem)

1. **P0.4 conteúdo comercial Ximendes** — precisa dos dados reais do operador (preços
   10 lentes R$1.500/2.500, 3x sem juros/21x, manutenção R$500, recontorno R$250/dente,
   sinal R$30) → cadastrar via UI de playbook ou script `update-clinic-playbook.ts`.
   Pedir confirmação dos valores ao dono antes.
2. **P0.5 bug do slot reoferecido** (caso Aylane) — reproduzir: `confirm_slot` com texto
   em vez de número + slot ainda listado; revisar TTL de reserva (15 min) e mensagem.
3. **Cancelar outbound pendente quando lead nega/muda de assunto** (caso Tarcisio, vídeos
   após "Não é lentes") — mexe no sender-worker/fila; mudança arriscada, fazer isolada.
4. **Fase 4 completa** — LLM-judge com rubrica de 5 eixos sobre o harness de replay;
   golden set = curadas da demo.
5. **Fase 5** — A/B de modelo no composer via harness; validar `gpt-5.5` contra demo e
   transcrições reais antes de promover como padrão em mais planos.
6. **Implementar itens 1-3 da estratégia de preenchimento** (caixa de perguntas,
   captura de correção, medidor de completude).

## Regras que pegam nesta área (não violar)

- "O sistema decide, a LLM verbaliza" — regra de negócio nova = código determinístico + teste.
- Preço/política SÓ em `commercialPolicy` (playbook_versions) — nunca em prompt/notes/descrição.
- `IntentClassifier` e `ResponseComposer` usam o MESMO `.slice(-N)` de histórico.
- Revisar diff com o agente `revisor-multitenant` antes do PR (toca orquestração/cron).
