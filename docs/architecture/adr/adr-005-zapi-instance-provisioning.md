# ADR-005: Provisionamento automático de instâncias Z-API

**Status:** Aprovado — **Fase 1 implementada (PR #134, 06/07/2026)**; Fases 2–3 pendentes
**Data:** 2026-07-06
**Contexto:** Eliminar a criação/configuração manual de instâncias no painel da Z-API a cada onboarding

---

## Contexto

Cada clínica nova exige hoje criar a instância no painel da Z-API à mão e
configurar webhook + toggles (feito manualmente para a Clínica Vitalli em
06/07/2026 — preset documentado abaixo). Erros manuais aqui quebram takeover,
mídia ou o webhook inteiro.

A Z-API expõe uma **API de parceiro integrador** que cobre criar, assinar,
cancelar e listar instâncias. Fatos verificados na doc oficial
(developer.z-api.io/partner/*):

- Criar: `POST https://api.z-api.io/instances/integrator/on-demand`, header
  `Authorization: Bearer <token>`, body `{ name, ...config }` → retorna
  `{ id, token, due }`. **Trial de 2 dias**; sem assinatura a instância é
  deletada.
- O **Client-Token da conta** autoriza até **25 instâncias**; com 10 criadas,
  solicita-se ao suporte o token definitivo de integrador (ilimitado).
  Temos ~3 — dá para implementar já.
- Cobrança pós-paga consolidada (dia 5 do mês seguinte) na conta do
  integrador. Cancelamento vale até o fim do ciclo.
- Assinar (`partner/sign-instance`, body opcional `{ withCalls }`), cancelar
  (`partner/unsubscribe-instance`), listar
  (`GET https://api.z-api.io/instances?page=1&pageSize=15`).
  ⚠️ Os paths exatos de assinar/cancelar não aparecem no export público da
  doc — **confirmar com uma chamada real ou suporte no início da Fase 2**
  (a Fase 1 não depende deles).

O pareamento por QR/código dentro do portal **já existe**
(`/api/owner/clinics/[clinicId]/channel-pairing`, PR #131). Este ADR cobre o
passo anterior: a instância nascer criada e configurada.

Detalhe de produto complementar em
`docs/product/zapi-provisionamento-automatico.md`.

## Preset padrão de instância (fonte da verdade)

| Config | Valor | Como |
|---|---|---|
| Webhook "Ao receber" | `https://app.systemops.com.br/api/whatsapp/zapi` (+ `?secret=<ZAPI_WEBHOOK_SECRET>` quando a env existir) | `receivedCallbackUrl` no create |
| Notificar enviadas por mim | ON (takeover pelo celular depende disso) | endpoint `webhooks/update-notify-sent-by-me` pós-create |
| Ignorar mensagens de grupos | ON | endpoint de filtros (`webhooks/update-filters`) pós-create |
| Demais webhooks | vazios | omitir no create |
| `autoReadMessage` | `false` (era `true` até 15/07/2026 — ver incidente abaixo) | create |
| `autoReadStatus` / `callRejectAuto` | `false` | create |
| `disableEnqueueWhenDisconnected` | `false` | create |
| `isDevice` | `false` (instância web) | create |

**Incidente 15/07/2026 — `autoReadMessage: true` suprimia notificação no celular
do cliente.** Múltiplos clientes reclamaram que pararam de receber notificação
do WhatsApp no próprio celular depois de conectar via Z-API. Causa: com
`autoReadMessage` ligado, o Z-API marca a mensagem como lida via API assim que
ela chega; o multi-device do WhatsApp sincroniza esse status pro celular quase
na hora, e em muitos aparelhos isso suprime o banner/som de notificação — a IA
recebe e processa normal, mas o dono da clínica não vê nada. Corrigido o
default no `createZApiInstance` para `false`. **Instâncias já provisionadas
antes dessa data continuam com o toggle ligado** — desligar manualmente em
"Ao receber" → "Configurações do WhatsApp" → "Ler mensagens automático" no
painel de cada instância (`app.z-api.io/app/instances/visualization/<id>`).

## Decisão

Três fases, PRs independentes.

### Fase 1 — Criar instância pelo wizard ✅ IMPLEMENTADA (PR #134)

Implementação mergeada em 06/07/2026: rota
`POST /api/owner/clinics/[clinicId]/channel-provision`, métodos
`createZApiInstance`/`applyZApiInstancePreset` no adapter, botão no wizard e
testes (`ChannelProvisionRoute`, `ZApiChannelAdapter`, `SaveWizardIdentity`).
A implementação refinou o desenho para **duas envs** (ver `.env.example`):

- `ZAPI_PARTNER_TOKEN` — só endpoints de parceiro (Bearer; criar/assinar/
  cancelar). Hoje é o Client-Token da conta; troca pelo token definitivo ao
  virar integrador oficial.
- `ZAPI_ACCOUNT_CLIENT_TOKEN` — header `Client-Token` das chamadas
  por-instância. Mesmo valor físico hoje (fallback no código), mas
  conceitualmente distinto: **não** muda quando o token de parceiro chegar.

⚠️ Operacional pendente: as duas envs ainda **não estão definidas no Vercel
de produção** (verificado 06/07) — sem elas o botão do wizard falha.

Desenho original da Fase 1 (mantido como registro):

1. **Env nova `ZAPI_PARTNER_TOKEN`** (Vercel + `.env.example`). Hoje recebe o
   Client-Token da conta; ao virar integrador oficial, troca o valor sem
   mudar código. Credencial de **plataforma** (como `RESEND_API_KEY`) — env é
   o lugar certo; não é credencial de tenant.
2. **Adapter** (`src/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter.ts`,
   seguir o padrão dos métodos existentes — timeout, tratamento de erro):
   - `createZApiInstance(name: string): Promise<{ instanceId, token, due }>`
     — POST on-demand com o preset embutido.
   - `applyZApiInstancePreset(creds): Promise<void>` — as 2 chamadas
     pós-create (notify-sent-by-me ON, filtro de grupos ON).
3. **Rota owner** `POST /api/owner/clinics/[clinicId]/channel-provision`
   (copiar padrão de auth/tenant de `channel-pairing/route.ts`): cria a
   instância com nome = nome da clínica, aplica preset, grava
   `zapiInstanceId`/`zapiToken`/`zapiClientToken` **criptografados** (usar
   `encryptCredentialNullable`, padrão de `scripts/create-clinic.ts`).
   Resposta só com status — token nunca vai ao client.
4. **Wizard** (passo de canal de
   `src/app/(owner)/owner/onboarding/[clinicId]/onboarding-wizard-client.tsx`):
   botão "Criar instância Z-API automaticamente" → chama a rota → preenche e
   trava os campos. Caminho manual permanece como fallback.
5. Registrar `due` do trial em memória do fluxo (toast/aviso no wizard:
   "parear em até 2 dias ou a instância expira"). Sem coluna nova na Fase 1.

Testes: adapter com fetch mockado (padrão dos testes de envio existentes);
rota rejeita não-owner; erro de token inválido/limite atingido vira mensagem
acionável no wizard.

### Fase 2 — Ciclo de vida da assinatura

1. Confirmar paths de assinar/cancelar (ver ⚠️ acima).
2. Assinar automaticamente quando o pareamento confirmar
   (`channelPairedAt` gravado) — não pagar instância que nunca conectou.
3. Coluna nova `organizations.zapi_instance_due` (timestamptz, migração em
   commit próprio) + alerta no email operacional se trial for expirar sem
   pareamento.
4. Ação owner "Desativar canal": unsubscribe + limpar credenciais; UI avisa
   que a cobrança corre até o fim do mês.
5. Bloco de reconciliação no owner: `GET /instances` × clínicas no banco →
   instâncias órfãs (custo morto).

### Fase 3 — Endurecimento

1. Definir `ZAPI_WEBHOOK_SECRET` no Vercel; incluir `?secret=` na URL gerada;
   migrar as instâncias existentes (Vitalli, Ximendes, Maycon) atualizando a
   URL no painel Z-API. A rota `/api/whatsapp/zapi` já suporta (só exige
   quando a env existe — rollout seguro).
2. Drift check: comparar config real da instância com o preset e expor botão
   "Reaplicar configuração" no owner.

## Regras do repo

- PR baseado na `main`; `npm run verify`; `revisor-multitenant` antes do push
  (rota nova + credenciais no diff).
- Tenant pelo `clinicId` da rota. `ZAPI_PARTNER_TOKEN` é a única env nova.
- Migração drizzle só na Fase 2, commit próprio.

## Consequências

- Custo por instância passa a nascer na conta SystemOps (pós-pago dia 5) —
  precificação por clínica precisa embutir (ver `docs/product/cost-control.md`).
- Pré-requisito comercial fora do código: iniciar cadastro no programa de
  parceiros (materiais.z-api.io/partners-campaign) e, com 10 instâncias,
  pedir o token definitivo ao suporte.

## Esforço estimado

| Fase | Esforço |
|---|---|
| 1 — Create + preset + wizard | 1–2 dias |
| 2 — Assinatura/ciclo de vida | 1–2 dias |
| 3 — Secret + drift check | 1 dia |
