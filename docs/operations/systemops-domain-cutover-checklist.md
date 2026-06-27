# Checklist — Cutover do domínio `systemops.com.br`

Data de registro: 2026-06-24

## Estado atual

- Domínios adicionados no Vercel:
  - landing: `systemops.com.br`
  - landing: `www.systemops.com.br`
  - app: `app.systemops.com.br`
- Produção já redeployada com:
  - `NEXT_PUBLIC_APP_URL=https://app.systemops.com.br`
  - `E2E_WEBHOOK_URL=https://app.systemops.com.br/api/whatsapp/zapi`
- Código local já ajustado para:
  - fallbacks do core em `app.systemops.com.br`
- DNS e SSL ativos para:
  - `https://systemops.com.br`
  - `https://www.systemops.com.br`
  - `https://app.systemops.com.br`
- Integrações externas já validadas:
  - Z-API aponta para `https://app.systemops.com.br/api/whatsapp/zapi`
  - Vercel Spend Management aponta para `https://app.systemops.com.br/api/webhooks/vercel/spend`
  - smoke assinado do webhook da Vercel respondeu `200 {"accepted":true,"recorded":false}`
- Itens sem ação nesta produção:
  - Google Calendar watch: nenhuma clínica está em `calendar_mode = google_calendar`
  - Meta Cloud API: nenhuma clínica possui `meta_phone_number_id` configurado
- Pendência operacional restante:
  - smoke real de entrada WhatsApp ainda depende de mensagem real, porque a produção não está com `E2E_MODE` habilitado

## Checklist para executar quando o DNS liberar

### 1. Finalizar zona DNS no Registro.br

- [x] Abrir `systemops.com.br` no painel do Registro.br
- [x] Entrar em `Configurar zona DNS`
- [x] Criar registro da landing:
  - tipo: `A`
  - nome: vazio / apex
  - dado: `76.76.21.21`
- [x] Criar registro da landing para `www`
  - tipo: `A`
  - nome: `www`
  - dado: `76.76.21.21`
- [x] Criar registro do app
  - tipo: `A`
  - nome: `app`
  - dado: `76.76.21.21`
- [x] Salvar alterações

## 2. Validar domínio no Vercel

- [x] Confirmar que `systemops.com.br` ficou como `Valid Configuration`
- [x] Confirmar que `www.systemops.com.br` também validou
- [x] Confirmar que `app.systemops.com.br` também validou
- [x] Confirmar emissão de SSL para todos os hosts

## 3. Ajustar integrações que dependem de URL pública

- [x] Z-API:
  - webhook de entrada deve apontar para `https://app.systemops.com.br/api/whatsapp/zapi`
  - se `ZAPI_WEBHOOK_SECRET` estiver em uso, manter `?secret=...` na URL configurada
- [x] Google Calendar:
  - renovar o watch para recriar o callback em `https://app.systemops.com.br/api/webhooks/google-calendar`
- [x] Vercel Spend Management:
  - confirmar webhook em `https://app.systemops.com.br/api/webhooks/vercel/spend`
  - ao salvar ou recriar o webhook, sincronizar o novo `VERCEL_SPEND_WEBHOOK_SECRET` no projeto e redeployar a produção
- [x] Meta Cloud API:
  - se alguma clínica usar Meta, webhook deve ficar em `https://app.systemops.com.br/api/whatsapp/webhook`

## 4. Validar aplicação em produção

- [x] Abrir `https://systemops.com.br`
- [x] Confirmar a landing pública
- [x] Abrir `https://app.systemops.com.br`
- [x] Confirmar acesso ao login e painel
- [x] Confirmar comportamento desejado de `www.systemops.com.br`
- [ ] Rodar smoke do webhook real com `E2E_WEBHOOK_URL`
- [ ] Enviar uma mensagem real no WhatsApp e validar:
  - entrada no webhook
  - criação/atualização da conversa
  - resposta da IA

## 5. Pós-cutover

- [x] Atualizar qualquer webhook/documentação externa ainda apontando para `systemops-core.vercel.app`
- [x] Confirmar que links de alertas operacionais e owner dashboard usam o domínio novo
- [x] Se tudo estiver verde, manter:
  - landing em `systemops.com.br`
  - app em `app.systemops.com.br`

## Itens que não precisam de troca por causa do domínio

- OpenAI / GPT
- Anthropic
- ElevenLabs
- Whisper
- OpenAI TTS
- Vercel Blob
