# Handoff checkpoint — Conversation V2 Internal Lab Live

Checkpoint escrito para retomar a execução sem reconstruir decisões ou confundir evidência local com release concluído.

## Estado Git no fechamento da Task 11

- Worktree: `/Users/brendonwalefy/Dev/Projetos/systemops-sales-engine-v2`
- Branch: `feat/conversation-core-v2`
- Implementation HEAD: `c63a1c21235aad2f60e77061ffe25104884dcd1f`
- Implementation tree: `9b78d1bd46d867fe38b836f11100e665015be637`
- Status antes deste documento: tracked worktree limpa
- Merge base registrado no ledger: `2df55b37be8a3e4c26eda3cb327499f5a3af4679`
- Spec: `docs/superpowers/specs/2026-08-17-conversation-v2-internal-lab-live-design.md`
- Plano: `docs/superpowers/plans/2026-08-17-conversation-v2-internal-lab-live.md`

O commit que contém este arquivo é o HEAD do checkpoint documental. Use `git rev-parse HEAD` e `git rev-parse 'HEAD^{tree}'` ao retomar; não reutilize approvals ou attestations emitidas para um HEAD anterior.

## Decisões que continuam vigentes

1. `TenantEngineRouter` é o único boundary de seleção V1/V2.
2. Não existe fallback V2 para V1 dentro do mesmo turno. Alteração da flag vale no turno seguinte.
3. `INTERNAL_LAB_READY` é authority separada do Cycle I e só autoriza SystemOps Lab/internal.
4. Cycle I permanece formalmente honesto: qualitative `NOT_MEASURABLE` / `PENDING_HUMAN_REVIEW`; não promover para PASS.
5. Dois reviewers humanos distintos/calibrados são obrigatórios antes do primeiro cliente externo, não antes do dogfooding interno.
6. Personas atravessam persistence, jobs, router, V2, outbox e sender existentes; delivery sintética é capturada. Nunca enviar WhatsApp a persona.
7. O número real do owner é um caminho separado pelo WhatsApp real existente.
8. Rollback deve provar `V2 -> V1 -> V2` entre turnos, preservando conversation state, dedupe, outbox e booking.
9. Não criar worker, queue, booking, outbox, inbox, dashboard, schema ou framework de Lab paralelos.
10. `main` é produção; o fluxo é branch -> PR para `develop` -> CI/aprovação -> promoção posterior. Nenhum push direto para `main`.

## Tasks concluídas

| Task | Resultado | Commits principais | Review final |
| --- | --- | --- | --- |
| 1 | authority Ed25519/configured target/build binding | `958f3b6e`, `110de63d` | 0 Critical / 0 Important |
| 2 | router tenant-scoped e authorization owner único | `89a2fa9b`, `704ff753` | 0 / 0 |
| 3 | lifecycle compartilhado e dedupe durável por insert winner | `25683e9a`, `1c2e8736`, `644d22c5` | 0 / 0 |
| 4 | dental live adapters/BookingService/state guards | `97ac67e6`, `341dd2e7` | 0 / 0 |
| 5 | V2 live handler, effects, shadow intent e model binding nominal | `f086085f`, `38b6c223`, `49dbc522`, `a855408f` | 0 / 0 |
| 6 | runtime composto, bindings reais, sender guard e no-fallback | `34d5ddb9`, `7fd90676`, `59644a21`, `5d3ab576`, `25ec53a0`, `4e598672`, `8fae83f4`, `a5673d69` | 0 / 0 |
| 7 | isolamento e rollback bidirecional pelo worker/sender reais | `6b8da8b1` | 0 / 0 |
| 8 | config declarativa/idempotente, snapshot/rollback/readiness | `d9fa0969`, `59cdc245` | 0 / 0 |
| 9 | delivery sintética fail-closed e claim exato na queue | `9eb1879a`, `7b514f16` | 0 / 0 |
| 10 | três personas e runner multi-turn durável | `1b64d094` | 0 / 0 |
| 11 | transcripts/traces/evals auditáveis com provenance real | `c63a1c21` | 0 / 0 |

Commit de suporte ao milestone: `9646b106` eliminou a corrida de filesystem da fixture de build attestation sem alterar produção.

## Findings relevantes e resolução

Todos os Critical/Important encontrados até a Task 11 foram corrigidos e re-revisados. Não há finding Critical/Important aberto no checkpoint.

- Authority/router: target, build, runtime, tenant, canal e config ficaram vinculados; ownership duplicada foi centralizada.
- Lifecycle: o insert atômico de `messages_external_id_idx` decide o vencedor antes dos efeitos mutáveis; retry/recovery não duplica lead, state, cost ou booking.
- Dental: reservations, conversation/appointment scope, evaluation-first, slot validity, CAS de confirmação e invalidation exata foram fechados.
- Live handler: sem fallback no turno; offer writes atrás do token; effect truth preservada; sender persiste placeholder idempotente; modelo live nominal não pode ser forjado.
- Runtime/sender: reply gate/opt-out, OpenAI key, config/editorial/voice/takeover, DB-derived digests, approval vigente e channel snapshot single-use são fail-closed.
- V1 compatibility: o sender reconhece apenas as representações canônicas exatas de depósito e primeira mídia; downgrade V2 permanece bloqueado.
- Rollback: `V2 -> V1 -> V2` preserva uma conversa, estado, outbox ordenada e um booking; erro V2 não chama V1 no mesmo turno.
- Lab config: snapshot externo 0600, alvo/owner exatos, TOCTOU/lock guards, rollback fiel e artifact sem segredos.
- Synthetic delivery: approval/current bindings, run/address e capture são nominais; owner real nunca entra no capture.
- Persona runner: failure/deferred usa lifecycle dos drains; próximo turno só começa depois da agent message persistida/capturada.
- Evidence: quatro artifacts finais exatos; overwrite recusado; provenance tenant/conversation/turn/outbound; PII/secrets/private URLs/provider payload bloqueados; PASS só com entailment; human/owner sempre pending.

## Evidência de verificação preservada

### Último milestone completo antes das Tasks 10–11

No commit `9646b106`, `npm run verify` executado exatamente, sem `.env.local`:

- Drizzle meta: PASS
- ESLint: 0 erros; 1 warning preexistente em `src/core/intelligence/ResponseComposer.ts:34`
- TypeScript: PASS
- Vitest: 380 suites PASS
- Testes: 3384 PASS, 11 skipped esperados
- Worktree: limpa

Os quatro testes exigidos de agenda também estavam verdes nos milestones anteriores; o último run explícito registrou 93/93 antes da ampliação de um caso de booking, e a Task 7 registrou 94/94.

### Task 10

- Focused: 25/25 PASS
- Dry-run das três personas: PASS
- Typecheck/ESLint/diff check: PASS
- Review independente: READY, 0 Critical / 0 Important

### Task 11

- Focused final: 14 arquivos, 185/185 PASS
- Review independente adicional: 142/142 PASS
- Typecheck/ESLint scoped/diff check: PASS
- Review final: READY, 0 Critical / 0 Important
- Nenhum DB, modelo, provider ou canal externo chamado durante a verificação

`npm run verify` ainda não foi executado sobre os bytes combinados das Tasks 10–11. Isso pertence à Step 4 da Task 12 e é a primeira verificação integral pendente.

`.env.test.local` não existe neste worktree; por isso `npm run test:db` não foi executado. Não usar `.env.local` para testes.

## Estado operacional externo

Nada abaixo foi executado:

- push ou PR;
- merge em `develop` ou promoção a `main`;
- CI/preview de PR;
- apply/verify/rollback contra DB compartilhado;
- emissão de approval para o build final;
- deploy Vercel;
- ativação V2 do tenant Lab;
- smoke WhatsApp do owner;
- execução produtiva das personas;
- emissão de `INTERNAL_LAB_READY`.

Portanto, SystemOps Lab ainda não está ativado em produção neste checkpoint.

## Primeira task aberta

**Task 12 — fechar scope gate, runbook e preparação de release.** Nenhum byte da Task 12 foi iniciado.

Primeira ação exata:

1. Confirmar branch/HEAD/tree/status e reler spec, plano Task 12, `README.md`, `docs/architecture/current.md` e `docs/operations/change-control.md`.
2. Criar RED em `src/__tests__/arch/SystemOpsLabScope.test.ts` que verifique boundaries/imports/scripts executáveis. Não escrever teste que apenas procura uma frase no runbook.
3. Completar `docs/operations/systemops-lab-runbook.md` e `README.md` com preconditions, outputs esperados, stop conditions e rollback completo.
4. Rodar a Step 4 canônica do plano:

```bash
npm test -- src/__tests__/TenantEngineRouter.test.ts src/__tests__/ConversationV2InternalLabApproval.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/ConversationV2LiveIsolation.test.ts src/__tests__/ConversationV2BidirectionalRollback.test.ts src/__tests__/InternalLabSyntheticDelivery.test.ts src/__tests__/SystemOpsLabPersonaRunner.test.ts src/__tests__/SystemOpsLabEvidence.test.ts src/__tests__/arch/TenantEngineRouterBoundary.test.ts src/__tests__/arch/SystemOpsLabScope.test.ts
npm test -- src/__tests__/SlotEngine.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/SlotDayPreference.test.ts src/__tests__/ClinicTimezone.test.ts
npm run verify
git diff --check
```

5. Fazer revisão independente integral contra a spec; corrigir todo Critical/Important; repetir a Step 4 se os bytes mudarem.
6. Commitar somente Task 12 com `docs(lab): finalize V2 activation runbook`.
7. Rodar `npm run verify` novamente após o commit em árvore limpa.

## Depois da Task 12: release gates, não tarefas de código

Seguir a seção `Release Gates — executar somente após as 12 Tasks` do plano. Esses gates mudam estado compartilhado e exigem authority humana/plataforma. Não marcar como concluídos por simulação.

A ordem começa por branch limpa -> `npm run verify` -> testes de agenda -> push -> PR para `develop` -> CI/preview -> aprovação humana -> merge em `develop` -> validação -> promoção aprovada a `main`. Somente depois emitir approval vinculada aos bytes finais, deployar globalmente em V1, configurar/verificar o Lab, ativar apenas o Lab, executar smoke/rollback/owner WhatsApp/personas/evidence e então avaliar `INTERNAL_LAB_READY`.

Os dois reviewers humanos calibrados continuam fora do gate de deploy interno e permanecem obrigatórios antes do primeiro cliente externo.
