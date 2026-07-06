# Provisionamento automático de instâncias Z-API

Plano para eliminar o processo manual de criar e configurar instâncias Z-API no
painel deles (feito à mão para a Clínica Vitalli em 06/07/2026). Objetivo: no
onboarding de uma clínica nova, o owner clica um botão e a instância nasce
criada, configurada com o preset padrão e com as credenciais já salvas — sem
abrir o painel da Z-API.

## Contexto

- A Z-API tem um **programa de parceiro integrador** que expõe criação,
  assinatura e cancelamento de instâncias por API
  (https://developer.z-api.io/partner/introduction).
- Antes do token definitivo de parceiro, o **token de segurança da conta
  (Client-Token)** permite criar até **25 instâncias** via API. Com 10
  instâncias criadas, pede-se o token de integrador ao suporte (criação
  ilimitada). Hoje temos ~3 — dá para começar já com o Client-Token.
- Cobrança do integrador é **pós-paga**: instâncias do mês são faturadas no dia
  5 do mês seguinte, na conta do integrador (SystemOps). Instância criada tem
  **trial de 2 dias**; sem assinatura, é deletada automaticamente.
- O pareamento por QR/código dentro do portal **já existe** (P0.5 do
  channel-safety, PR #131). Este plano cobre o passo anterior: a instância
  nascer pronta.

## Preset padrão de instância (o que foi feito à mão na Vitalli)

| Config | Valor | Como automatizar |
|---|---|---|
| Webhook "Ao receber" | `https://app.systemops.com.br/api/whatsapp/zapi` (+ `?secret=` quando `ZAPI_WEBHOOK_SECRET` existir) | `receivedCallbackUrl` no body do create |
| Notificar enviadas por mim | ligado (takeover pelo celular) | `PUT .../update-notify-sent-by-me` após criar — o create não cobre |
| Demais webhooks | vazios | omitir no create |
| Ignorar mensagens de grupos | ligado | endpoint de filtros (`webhooks/update-filters`) após criar |
| Ler mensagens automático | ligado | `autoReadMessage: true` no create |
| Rejeitar chamadas / ler status | desligados | `callRejectAuto: false`, `autoReadStatus: false` |
| Enfileiramento quando desconectado | mantido (fila ativa) | `disableEnqueueWhenDisconnected: false` |
| Tipo | instância web | `isDevice: false` |

## Endpoints Z-API (parceiro)

Auth: `Authorization: Bearer <token da conta ou de parceiro>`; sem Client-Token
no header nessas rotas.

- **Criar**: `POST https://api.z-api.io/instances/integrator/on-demand` — body
  `{ name, receivedCallbackUrl, autoReadMessage, ... }` → retorna
  `{ id, token, due }` (https://developer.z-api.io/partner/create-instance)
- **Assinar**: partner/sign-instance (body opcional `{ withCalls }`)
- **Cancelar**: partner/unsubscribe-instance — instância segue ativa até o fim
  do ciclo (último dia do mês) e a cobrança do ciclo é devida
- **Listar**: `GET https://api.z-api.io/instances?page=1&pageSize=15`
- Confirmar na implementação os paths exatos de assinar/cancelar (a doc pública
  não expõe o path no export; validar com uma chamada real ou com o suporte).

## Fase 1 — Criar instância pelo wizard (o core)

1. **Env nova**: `ZAPI_PARTNER_TOKEN` (Vercel + `.env.example`). Hoje recebe o
   Client-Token da conta (`F88...`); quando virarmos integrador, troca pelo
   token definitivo sem mudar código. É credencial da plataforma (como
   `RESEND_API_KEY`), não de tenant — env é o lugar certo.
2. **Adapter** (`zapi-channel-adapter.ts`, padrão dos métodos existentes):
   - `createZApiInstance(name)` → POST on-demand com o preset padrão embutido;
     retorna `{ instanceId, token, due }`.
   - `applyZApiInstancePreset(creds)` → chamadas pós-criação que o create não
     cobre: notify-sent-by-me ON e filtro de grupos ON.
3. **Rota owner-only** `POST /api/owner/clinics/[clinicId]/channel-provision`
   (padrão da `channel-pairing`): cria a instância com nome = nome da clínica,
   aplica o preset, grava `zapiInstanceId`/`zapiToken`/`zapiClientToken`
   criptografados (padrão `create-clinic.ts`) e devolve só status — token
   nunca vai ao client.
4. **Wizard** (passo de canal do onboarding): botão "Criar instância Z-API
   automaticamente" que chama a rota e preenche/trava os campos. Mantém o
   caminho manual como fallback (instância criada fora, ex.: Vitalli).
5. Testes: adapter com fetch mockado (padrão dos testes de envio); rota
   resolvendo tenant pelo clinicId; erro de token inválido/limite de 25.

## Fase 2 — Ciclo de vida da assinatura

1. **Assinar no momento certo**: disparar sign-instance quando o pareamento
   confirmar conexão (`channelPairedAt` gravado) — não pagar instância que
   nunca conectou. Guardar `due` da criação e alertar (email operacional já
   existente) se o trial de 2 dias for expirar sem pareamento.
2. **Cancelar no offboarding**: ação owner "Desativar canal" → unsubscribe +
   limpar credenciais. Deixar claro na UI que a cobrança vai até o fim do mês.
3. **Reconciliação**: bloco no painel owner listando instâncias da conta
   (`GET /instances`) × clínicas no banco, para achar instância órfã (criada e
   nunca vinculada = custo morto).

## Fase 3 — Endurecimento

1. Definir `ZAPI_WEBHOOK_SECRET` no Vercel e incluir `?secret=` na URL gerada
   pelo provisionamento (a rota `/api/whatsapp/zapi` já suporta; migrar a
   Vitalli e a Ximendes junto, atualizando a URL no painel).
2. **Drift check**: comparar a config real da instância com o preset e expor
   botão "Reaplicar configuração" no owner (cobre instância criada à mão ou
   mexida no painel da Z-API).

## Pré-requisito comercial (fora do código)

- Cadastrar cartão na conta Z-API (painel → dados da conta/financeiro) — a
  cobrança pós-paga do integrador cai toda na conta SystemOps.
- Ao atingir 10 instâncias, solicitar ao suporte o token definitivo de
  integrador (via https://materiais.z-api.io/partners-campaign ou suporte).
- Precificação por clínica já deve embutir o custo da instância (ver
  `docs/product/cost-control.md` / especialista-infra).

## Regras do repo que se aplicam

- PRs baseados na `main`; `npm run verify` verde; `revisor-multitenant` antes
  de push (rota nova + credenciais criptografadas no diff).
- Tenant sempre pelo `clinicId` da rota; `ZAPI_PARTNER_TOKEN` é a única env
  nova e é da plataforma, não do tenant.
- Migração só se a Fase 2 guardar `due`/estado de assinatura em coluna nova
  (commit próprio, padrão drizzle).
