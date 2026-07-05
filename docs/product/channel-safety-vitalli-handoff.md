# Handoff — Channel Safety para a Clínica Vitalli

Tarefas prioritárias de implementação para deixar a Fase 0 do Channel Safety
Engine operável antes de plugar o número da Clínica Vitalli (primeiro cliente
real, número já em risco de ban: dono rodou automações próprias + alto volume de
campanhas).

Pré-requisito: **Fase 0 já está 100% na main** (PRs #124–#129). Contexto e
decisões em:

- `docs/product/channel-safety-fase0-handoff.md` (o que já foi feito)
- `docs/product/channel-safety-engine-refinado.md` (produto e fases futuras)

Todas as tarefas abaixo assumem a Fase 0 na main. Basear PRs na `main`
atualizada. `npm run verify` verde antes de cada push. Rodar o agente
`revisor-multitenant` antes de cada push. Tenant sempre resolvido pelo clinicId
da rota, nunca por env.

## Por que estas tarefas (e não Fase 1)

O Safety Gate já existe e funciona, mas dois controles que a Vitalli precisa não
têm superfície de uso:

- as caps de saída (`organizations.outbound_hourly_cap` / `outbound_daily_cap`,
  default 40/200) **não têm nenhuma UI** — só dá para mudar no banco;
- não há um "reply ligado / reengajamento desligado" por clínica
  (`shouldSendAutomatedClinicOutbound` mistura reply e automação via
  `autoReplyEnabled`).

Sem isso, aplicar o preset conservador da Vitalli (caps 15/60, recovery off,
reply-only 2 semanas) exigiria cirurgia no banco. Fase 1 (health score, painel
Reputation Guard) **não** é prioridade para uma única clínica nas primeiras
semanas.

## Ordem recomendada

1. **P0** — controles de segurança na UI do owner (destrava a Vitalli).
2. **P0.5** — pareamento por QR/código no onboarding (conecta o número da
   Vitalli dentro do nosso portal).
3. **P1** — validar/endurecer o opt-out (`stop_contact`).
4. **P2** — observabilidade das decisões do gate (bom-ter para a 1ª semana).

P0 e P0.5 são independentes e podem ir em paralelo (agentes/PRs separados).

---

## P0 — Controles de segurança do canal na UI do owner

O Safety Gate usa `organizations.outbound_hourly_cap` e `outbound_daily_cap`
(já existem, default 40/200), mas não há UI para editá-las por clínica.
Objetivo: aplicar o preset conservador da Vitalli (caps baixas + reengajamento
off) sem editar o banco na mão.

Tarefa (um PR):

1. Na página do owner da clínica
   (`src/app/(owner)/owner/clinics/[clinicId]/`), adicionar uma seção
   "Segurança de canal" com:
   - campos numéricos para `outbound_hourly_cap` e `outbound_daily_cap` (com os
     defaults atuais e validação > 0);
   - um toggle "Pausar reengajamento (recovery/follow-up)" que **não** desligue
     as respostas a inbound. Hoje `shouldSendAutomatedClinicOutbound`
     (`src/application/automation/clinic-automation-policy.ts`) mistura reply e
     automação via `autoReplyEnabled` — **não reutilizar isso**. Criar um campo
     próprio, ex.: `organizations.automated_reengagement_paused` (boolean,
     default false), e fazer os crons de reengajamento (`follow-up-dispatcher`,
     `recovery-campaign`) checarem esse flag. Decidir e **documentar** se
     `appointment-reminder` fica de fora do toggle (recomendado ficar de fora:
     lembrete é de compromisso que o lead marcou).
2. Migração drizzle em commit próprio; rodar
   `npx tsx scripts/check-drizzle-meta.ts --fix` se o `db:check` reclamar.
3. Server action para salvar, seguindo o padrão das outras edições de clínica no
   owner. Resolver tenant pelo `clinicId` da rota.

Testes: comportamento de pausa nos crons (reengajamento pausado não enfileira;
reply segue funcionando). Fora de escopo: health score, painel de reputação
(Fase 1).

## P0.5 — Pareamento por QR/código no onboarding

Hoje conectar o número exige acessar o painel da Z-API e escanear o QR de lá.
Objetivo: conectar o número **dentro do nosso portal** no onboarding. Contexto
e justificativa na seção "Pareamento no nosso portal" de
`channel-safety-engine-refinado.md`. **Não muda a reputação do número**, mas
reduz relogins (sinal de risco), vira ponto de controle (captura idade do
número, início de warmup) e é 100% white-label.

A Z-API expõe por API (confirmado; adapter ainda não tem esses métodos —
`src/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter.ts` só tem
envio hoje):

- `GET https://api.z-api.io/instances/{instance}/token/{token}/qr-code/image`
  → QR em base64 para renderizar.
- `GET .../phone-code/{phone}` → código de pareamento digitado no próprio
  WhatsApp ("Conectar com número de telefone"), sem câmera — melhor no mobile.
- `GET .../status` (ou equivalente) → estado da conexão (connected/disconnected)
  para polling.

Tarefa (um PR):

1. Adicionar ao adapter Z-API: `getZApiQrCodeImage(creds)`,
   `getZApiPhoneCode(creds, phone)` e `getZApiConnectionStatus(creds)`.
   Credenciais por clínica via `resolveChannelConfig` (nunca env). Tratar QR
   expirado (recarregar) e erros de rede como os métodos de envio já fazem.
2. No wizard de onboarding
   (`src/app/(owner)/owner/onboarding/[clinicId]/onboarding-wizard-client.tsx`),
   o passo de canal já coleta `zapiInstanceId`/`zapiToken`/`zapiClientToken`.
   Estender esse passo com um sub-passo "Conectar WhatsApp": renderizar o QR
   (base64) **e** oferecer o código de pareamento como alternativa; fazer
   polling do status e avançar automaticamente quando `connected`.
3. Rota/server action fina que chama o adapter resolvendo o tenant pelo
   `clinicId` da rota. Não expor token da Z-API ao client — o QR/código vêm do
   backend.
4. Ao conectar com sucesso, registrar o momento (ex.: para iniciar warmup na
   Fase 1). Guardar como campo simples agora, sem inventar tabela.

Testes: os novos métodos do adapter (mock do fetch, como os testes de envio
existentes); estado de "conectado/expirado" da UI. Fora de escopo: warmup
automático (Fase 1), providers não-Z-API (Fase 2).

## P1 — Validar e endurecer o opt-out (stop_contact)

O PR #129 adicionou o intent `stop_contact` e a regra determinística no
`ConversationOrchestrator` que grava `leads.contact_consent_revoked_at`.
Ressalva conhecida: o handler do orchestrator e a classificação LLM **não têm
teste unitário** (o repo não tem harness que instancie o
`ConversationOrchestrator`). Como a Vitalli tem alto volume, o opt-out será
exercido e precisa de confiança.

Tarefa:

1. Validação manual E2E: numa clínica de teste com `shadowModeEnabled=true`,
   enviar frases de opt-out ("não quero mais receber mensagens", "me tira dessa
   lista") e confirmar que `contact_consent_revoked_at` é gravado e que a
   confirmação sai. Testar também os **negativos** ("não quero esse horário",
   "tchau", "desisti do tratamento") e confirmar que **não** gravam opt-out.
2. Endurecer o teste automatizado: hoje `src/__tests__/StopContactIntent.test.ts`
   só cobre o contrato do schema + o efeito no gate. Se viável sem criar um
   harness pesado, extrair a regra de opt-out do orchestrator para uma função
   testável (padrão dos builders puros dos PRs 3–5) e testá-la; senão,
   documentar por que não e reforçar o teste de classificação (exemplos
   positivos/negativos) se houver seam para mockar o `IntentClassifier`.
3. Confirmar que a confirmação de opt-out sai (categoria `reply` não é gated)
   mas que follow-up/recovery seguintes são cancelados.

## P2 — Observabilidade das decisões do gate

O Safety Gate (`src/application/channel-safety/`, `send-message-job.ts`) já
cancela (`consent_revoked`) e adia (caps/`quiet_hours`) envios, gravando o
motivo em `outbound_messages.last_error`/`status` e logando
`job.deferred`/`job.ignored`. Falta visibilidade para monitorar o número da
Vitalli na 1ª semana.

Tarefa (leve, sem tabela nova se possível):

1. Um endpoint/rota owner ou um bloco na página da clínica que agregue, por
   clínica e período: nº de opt-outs (leads com `contact_consent_revoked_at`),
   nº de outbound cancelados por `consent_revoked`, nº de deferrals por cap e
   por `quiet_hours` (ler de `outbound_messages` por `status`/`last_error`).
2. Opcional: incluir esses números no email de `channel-health-alert`
   (`src/app/api/cron/channel-health-alert`) como sinal precoce.

Consultas baratas (índices já existentes em `outbound_messages`).

## Depois destes: aplicar o preset da Vitalli

Com o P0 no ar, aplicar (config, não código): caps `outbound_hourly_cap=15` /
`outbound_daily_cap=60`, reengajamento pausado, reply-only nas 2 primeiras
semanas; subir gradualmente com taxa de resposta saudável. E o combinado
comercial: o dono precisa **parar as campanhas que dispara por fora** no mesmo
número — o gate não protege tráfego que não passa pelo SystemOps.
