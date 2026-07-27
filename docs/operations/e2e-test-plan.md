# Plano de Testes E2E — Validação Pré-Produção (Start/Growth)

> Checklist de validação manual/assistida para rodar antes e durante o onboarding de
> clientes reais (pagos ou piloto). Cobre as features vendáveis do escopo atual
> (`docs/product/pricing-strategy.md`) e a capacidade real de infra
> (`docs/product/cost-control.md`).
> Segue o processo de `docs/operations/change-control.md` — cada seção abaixo tem os
> testes automatizados equivalentes já existentes em `src/__tests__`, quando houver.

Use este documento como roteiro de execução, não como substituto dos testes
automatizados — testes automatizados provam a regra de negócio isolada; este plano prova
o comportamento do sistema como um todo, com dados e canais reais/simulados.

> **Privacidade:** não use nem reative
> `/api/e2e/production-conversations`. A rota de exportação bruta está
> deliberadamente desativada. Conversas reais só poderão entrar no novo replay
> pelo exportador anonimizado descrito em
> [`docs/architecture/replay-and-decision-trace.md`](../architecture/replay-and-decision-trace.md).

---

## Achados da primeira execução (jul/2026) — ler antes de rodar de novo

Validação executada contra produção real (`app.systemops.com.br`), clínica QA Start
(`isTest=true`, plan `essencial`, slug `qa-start-clinic`), Z-API com credenciais falsas
(garante que nenhum envio real de WhatsApp é possível, mesmo com o resto do pipeline
funcionando de verdade — só falha no envio final por instância inválida).

**1. Produção não tem nenhuma flag de QA configurada na Vercel** — só existem em
`.env.local`. `E2E_MODE`, `DISABLE_REAL_WHATSAPP_SEND`, `DISABLE_REAL_OPENAI` não
existem no ambiente de produção. Ou seja, qualquer teste contra produção gera custo
real de OpenAI (pequeno) e tentaria envio real de WhatsApp se as credenciais Z-API
fossem reais — **sempre use credenciais Z-API falsas ao testar contra produção**.

**2. Clínica nova criada via `create-clinic.ts` sempre nasce com `autoReplyEnabled =
false`** (default do schema) — a IA não responde nada até esse campo ser ativado
manualmente. Isso é uma trava de segurança intencional (evita a IA responder antes do
onboarding terminar), não um bug — mas **precisa entrar explicitamente no checklist de
go-live de cada cliente novo**, senão o cliente entra em produção com a IA muda.

**3. `autoReplyEnabled = true` sozinho não é suficiente.** O gate real
(`src/application/automation/clinic-automation-policy.ts`) só resolve `live` quando
`operationalStatus === "active"` e `autoReplyEnabled = true`. Shadow resolve
`observe`: registra o inbound e encerra antes das decisões da IA. Clínicas de teste
devem validar o fluxo completo pela rota de replay em banco isolado, nunca ligando
shadow para tentar simular produção.

**4. O golden path antigo de shadow foi descontinuado por segurança.** Shadow não
compõe respostas, não avança funil, não cria reservas/agendamentos e não dispara
follow-ups. O golden path obrigatório agora é o replay `closed_loop`, que atravessa
webhook, filas, orquestrador, outbox e sender reais dentro de um banco sandbox, com
adapters de captura para qualquer efeito externo. Cenários aprovados que contenham
rajadas consecutivas do lead também devem rodar no modo `concurrency`; mensagens
isoladas permanecem sequenciais e só a rajada disputa os mesmos claims e filas de
produção.

**5. `scripts/e2e-webhook-test.ts` precisa de `E2E_WAIT_MS` bem maior que o default
(12000ms) ao rodar contra produção real** — latência de composição de IA + fila real
facilmente passa de 20-30s. Recomendado `E2E_WAIT_MS=45000` ou mais como piso ao testar
contra produção (o default foi calibrado para um ambiente mais controlado).

**6. Falha não resolvida — Grupo A do harness (`e2e-webhook-test.ts`, sem `--smoke`)**:
mesmo com `E2E_WAIT_MS=45000`, os testes A1-A4 falham consistentemente com "Conversa não
criada no DB", enquanto B1/B2/C1/C2 passam normalmente no mesmo run. Reproduzi o payload
exato de A1 (`"oi"`, primeira mensagem) manualmente fora do harness — **funcionou
perfeitamente** (lead criado, conversa criada, IA respondeu com intent `greeting`
correto em ~28s). Isso indica que a falha é do **harness de teste** (`e2e-webhook-test.ts`
Grupo A), não do pipeline de produção — mas não foi root-caused ainda. **Não tratar como
bug de produto até investigar mais** — próxima sessão: instrumentar o script pra logar
o `phoneA` gerado e comparar contra o que realmente chegou no banco.

---

## 0. Preparação do ambiente de teste

- [ ] Rodar `npm run verify` limpo antes de começar (lint, typecheck, db:check, testes)
- [ ] Confirmar as travas do replay (`E2E_MODE`, `E2E_REPLAY_MODE` e hosts sandbox/
  produção distintos); não usar flags genéricas como substituto do banco isolado
- [ ] Provisionar banco/branch isolado e carregar o snapshot versionado da clínica
  avaliada (nunca executar replay no banco ativo)
- [ ] Confirmar Z-API de teste conectado e webhook validado (`POST /api/whatsapp/zapi`)
- [ ] Confirmar plano da clínica de teste (`essencial` ou `avancado`) e que
  `clinic_modules` reflete a matriz esperada (ver seção 8)

---

## 1. Onboarding — do zero ao primeiro atendimento

- [ ] Criar clínica com `create-clinic.ts`, preencher: nome, slug, especialidade,
  timezone, saudação, credenciais Z-API, e-mail/senha do admin
- [ ] Confirmar `clinic_modules` criado automaticamente conforme o plano
  (`syncModulesForPlan` / `applyClinicPlanPreset`)
- [ ] Publicar playbook mínimo (tom de voz, política comercial, 1 tratamento) e
  confirmar status `active` em `playbook_versions`
- [ ] Checklist do Blueprint (`/owner/clinics/[clinicId]/blueprint`) — todos os blocos
  (identidade, canal, agenda, playbook, tratamentos, comercial, go-live) devem fechar
  antes de considerar a clínica pronta para receber lead real
- Teste automatizado equivalente: `ClinicBlueprint.test.ts`, `OnboardingTreatmentSync.test.ts`

## 2. Atendimento IA — golden path da conversa

- [ ] Lead novo manda "Oi, quero saber sobre [tratamento]" — IA responde em menos de
  ~1 min, qualifica, oferece horário
- [ ] Lead confirma horário oferecido → agendamento aparece em `/app/agenda`
- [ ] Lead manda mensagem fora do horário comercial → IA responde do mesmo jeito
  (recepcionista 24h é a promessa central do produto)
- [ ] Lead manda áudio → IA transcreve (Whisper) e responde corretamente
- [ ] Lead manda mensagem com imagem/documento → sistema classifica mediaType sem erro
- [ ] Mensagens rápidas em sequência → debounce agrupa antes de responder (não manda
  3 respostas picadas)
- Teste automatizado equivalente: `ConversationExperience.test.ts`,
  `ResponseComposerExperience.test.ts`, `AudioTranscription` (verificar nome atual em
  `src/__tests__`), `AgentResponseThrottle.test.ts`

## 3. Qualificação e temperatura de lead

- [ ] Lead com interesse claro em tratamento caro → classificado `hot`/`warm`
  corretamente
- [ ] Lead que só pergunta "quanto custa" e some → não devia virar `hot` sem engajamento
  real
- [ ] Status do lead evolui corretamente: `new` → `waiting_response` →
  `in_conversation` → `appointment_scheduled` (ou `follow_up_due`/`lost`)
- Teste automatizado equivalente: `TemperatureInference.test.ts`

## 4. Agenda — casos de borda (maior superfície de risco técnico)

- [ ] Dois leads tentando o mesmo horário ao mesmo tempo → só um consegue, o outro
  recebe horário alternativo (lock otimista)
- [ ] Cancelamento por WhatsApp → horário libera na agenda imediatamente
- [ ] Remarcação por WhatsApp → agendamento antigo cancelado, novo criado, sem duplicar
- [ ] Bloqueio manual de agenda pelo operador → IA não oferece esse horário
- [ ] Timezone da clínica diferente de UTC → horários exibidos e confirmados batem com
  o horário local real (testar pelo menos 1 clínica em fuso não-Brasília se houver)
- [ ] Buffer pós-consulta configurado → não é oferecido horário colado no anterior
- Teste automatizado equivalente: `SlotEngine`, `BookingDoubleBooking`,
  `SlotDayPreference`, `ClinicTimezone`, `SlotReservationOverlap`,
  `InternalCalendarGateway`, `ReschedulingFlow.test.ts` — rodar explicitamente:
  ```bash
  npm test -- src/__tests__/SlotEngine.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/SlotDayPreference.test.ts src/__tests__/ClinicTimezone.test.ts
  ```

## 5. Lembretes, follow-up e recuperação

- [ ] Lembrete D-1 dispara para agendamento do dia seguinte (cron
  `appointment-reminder`, 13h UTC)
- [ ] Lead que não responde depois de N horas entra em follow-up automático
  (`follow-up-dispatcher`, 10h UTC)
- [ ] Lead parado há dias é alcançado pela campanha de recuperação (Growth apenas —
  `recovery-campaign` / `recovery-campaign-evening`) — **conferir que Start não recebe
  isso**, conforme a matriz de planos
- Teste automatizado equivalente: `FollowUpDispatchPolicy.test.ts`,
  `FollowUpClaimBeforeSend.test.ts`, `LeadRebooking.test.ts`, `StaleConversations.test.ts`

## 6. Inbox e handoff humano

- [ ] Lead manda mensagem fora do playbook (ex.: sintoma clínico sensível) → IA pausa e
  pede humano, conversa aparece em "Atenção Humana"
- [ ] Operador pausa a IA manualmente → IA para de responder até TTL expirar ou
  operador retomar
- [ ] TTL de takeover expira sem ação do operador → IA retoma sozinha
- [ ] 3 mensagens confusas seguidas → takeover automático por `unclearThreshold`
- [ ] Operador manda mensagem manual pelo inbox → aparece como `clinic_user`, não como
  IA, no histórico do lead
- [ ] Recomendação de resposta ao operador aparece corretamente (Growth apenas)
- Teste automatizado equivalente: `InboxVisibility.test.ts`, `HumanTakeoverTTL.test.ts`,
  `NeedsHumanHandoff.test.ts`

## 7. Voz — validar a nova régua Start/Growth

- [ ] Start: módulo `voice_tts` ativo, modo padrão `impact` — só mensagens de alto
  impacto (saudação, agendamento, confirmação, preço) saem em áudio
- [ ] Start: trocar modo para `mix`/`full` na aba Voz da clínica → comportamento muda
  de acordo, sem precisar de deploy
- [ ] Growth: `voice_elevenlabs` ativo com `voiceId` configurado, modo `full` → toda
  resposta relevante sai em B-WAVE (ElevenLabs), não em OpenAI
- [ ] Growth sem `voiceId` cadastrado → sistema cai para texto sem erro (fallback
  silencioso, conforme `sendVoiceOrText`)
- [ ] Lead manda áudio → resposta vem em áudio por simetria, mesmo fora do modo
  configurado
- [ ] Confirmar em `tts_usage_costs` que o consumo de caracteres do B-WAVE em modo full
  está sendo registrado corretamente por clínica (ponto de atenção de margem, ver
  `pricing-strategy.md` §6.2)
- Teste automatizado equivalente: `VoiceModeGreetingOnly.test.ts`,
  `NormalizingTtsGateway.test.ts`, `ElevenLabsTtsGateway.test.ts`

## 8. Entitlement por plano — checagem manual (ainda não é enforced automaticamente)

Lembrete: hoje não existe bloqueio automático (`docs/operations/billing-roadmap.md`
Fase 3) — a garantia é conferir manualmente que `clinic_modules` bate com a matriz de
planos antes de liberar a clínica para o cliente:

| Módulo | Start deveria ter? | Growth deveria ter? |
|---|---|---|
| `menu_mode` | ✅ | ✅ |
| `concierge_mode` | ❌ | ✅ |
| `voice_tts` | ✅ | ✅ |
| `voice_elevenlabs` | ❌ | ✅ (modo full) |
| `revenue_pipeline` | ❌ | ❌ (retirado do catálogo vendável) |
| `team_roles` | ❌ | ✅ |
| `video_library` | ❌ | ✅ |
| `ai_co_writer` | ❌ | ✅ |

- [ ] Conferir essa tabela em `/owner/clinics/[clinicId]/modules` para cada clínica
  onboardada antes de liberar acesso ao cliente

## 9. Avatar / conta do usuário (regressão conhecida — corrigida em jul/2026)

- [ ] Upload de foto de perfil (`/app/settings` → aba perfil) → aparece no rodapé do
  menu lateral desktop, não só no menu mobile
- [ ] Remover foto → volta para iniciais
- [ ] Foto persiste após logout/login (não é sessão, é `clinicMembers.avatarUrl`)
- Causa raiz do bug: `sidebar-nav.tsx` renderizava sempre as iniciais no rodapé
  desktop, ignorando `avatarUrl` — corrigido para mostrar a foto quando existir

## 10. Capacidade de infra — validação sob carga real

Ver `docs/product/cost-control.md` § "Capacidade Real de Conversas — Infra Atual" —
teto estimado de ~225 conversas/mês agregadas no Neon Free tier.

- [ ] Confirmar plano do Neon **antes** de ativar o primeiro cliente pago (fazer upgrade
  para Launch se ainda estiver em Free)
- [ ] Acompanhar `Neon dashboard → Compute (CU-hrs)` diariamente durante a primeira
  semana de cada cliente novo, não só no fechamento do mês
- [ ] Confirmar que `message-worker`/`sender-worker` (cron a cada minuto) estão
  realmente rodando nessa frequência em produção — checar histórico de execução no
  Vercel, não assumir pelo `vercel.json`
- [ ] Rodar `scripts/e2e-webhook-test.ts` contra o ambiente de staging antes de cada
  onboarding para validar o fluxo de webhook ponta a ponta com payload real replayado
- [ ] Registrar, por clínica piloto, o volume real de conversas/mês nas primeiras 2
  semanas — usar para corrigir a extrapolação de capacidade (amostra de 36 conversas é
  pequena demais para ser definitiva)

---

## Ordem de execução recomendada para o onboarding de amanhã

1. Seção 0 (preparação) + Seção 1 (onboarding) — por clínica nova
2. Seção 2 a 6 (golden path completo) — com mensagens reais de teste, não só automação
3. Seção 7 — validar a régua de voz nova antes de mostrar ao cliente
4. Seção 8 — checagem manual de entitlement, específica do plano contratado
5. Seção 9 — confirmar fix do avatar
6. Seção 10 — checar Neon **antes** de considerar a clínica "em produção" de verdade

Qualquer item que falhar aqui deve travar o go-live daquela clínica específica, não só
ser anotado para depois.
