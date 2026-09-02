# Provisionar um tenant no WAHA

Runbook do provedor self-hosted definido na [ADR-010](../architecture/adr/adr-010-provedor-whatsapp-alternativo-waha.md).

> **Escopo.** WAHA é para lab, demo, piloto e números descartáveis. Cliente
> pagante continua em Z-API ou Meta Cloud API. O ban de API não oficial é
> permanente e sem apelação, e o número banido é o ativo do cliente.

## Contas necessárias

| O quê | Onde | Custo | Observação |
| --- | --- | --- | --- |
| **VPS com IP brasileiro** | Hostinger (`hostinger.com.br/vps`) ou Vultr (`vultr.com`, região São Paulo) | R$ 30-60/mês | Única conta realmente necessária. IP estrangeiro com número BR é sinal de risco na detecção |
| WAHA | Nenhuma | R$ 0 | Imagem pública `devlikeapro/waha`. Desde a 2026.6.1 não há tier pago nem licença a ativar |
| Chip de WhatsApp | Operadora | ~R$ 10-30/mês | **Número descartável.** Nunca o número pessoal nem o de um cliente |

Não é preciso criar conta no WAHA, na Meta, nem em nenhum painel de API. É o
oposto da Z-API: o servidor é seu.

## 1. Subir o servidor

Na VPS, com Docker instalado:

```bash
docker run -d \
  --name waha \
  --restart always \
  -p 3000:3000 \
  -e WAHA_API_KEY='<chave-forte-gerada-por-voce>' \
  -e WHATSAPP_DEFAULT_ENGINE=GOWS \
  -e WHATSAPP_HOOK_URL='https://<seu-dominio>/api/whatsapp/waha?secret=<WAHA_WEBHOOK_SECRET>' \
  -e WHATSAPP_HOOK_EVENTS=message \
  -v waha-sessions:/app/.sessions \
  devlikeapro/waha
```

- `GOWS` (Go/whatsmeow) é a engine mais econômica por sessão e a que permite
  trocar para `NOWEB` sem mexer na integração se o protocolo quebrar.
- O volume é obrigatório: sem ele a sessão se perde a cada restart e o QR
  precisa ser lido de novo.
- Ponha o servidor atrás de HTTPS (Caddy ou nginx). O `X-Api-Key` trafega em
  todas as chamadas.

## 2. Criar a sessão

O nome da sessão **é único em toda a frota** — o banco tem índice único em
`organizations.waha_session`. O webhook do WAHA só informa o nome da sessão,
não o servidor de origem; sem unicidade, duas organizações com sessão
`default` embaralhariam mensagens entre si. Use o slug da organização.

```bash
curl -X POST https://<waha>/api/sessions \
  -H 'X-Api-Key: <chave>' -H 'Content-Type: application/json' \
  -d '{"name":"<slug-da-organizacao>","start":true}'

# QR code para parear o celular
curl https://<waha>/api/<slug>/auth/qr -H 'X-Api-Key: <chave>' --output qr.png
```

Sessão pronta quando o status vira `WORKING`:

```bash
curl https://<waha>/api/sessions/<slug> -H 'X-Api-Key: <chave>'
```

## 3. Cadastrar a organização

Três campos em `organizations`, com `channel_provider = 'waha'`:

| Coluna | Valor |
| --- | --- |
| `waha_base_url` | `https://<seu-waha>` (sem barra final; o código remove por segurança) |
| `waha_api_key` | a chave do `WAHA_API_KEY`, **criptografada pelo credential vault** |
| `waha_session` | o nome da sessão, único na frota |

## 4. Variável de ambiente

`WAHA_WEBHOOK_SECRET` na Vercel, igual ao `?secret=` do `WHATSAPP_HOOK_URL`.
Enquanto a env não existir, a rota aceita sem validar — é o que permite fazer
o rollout sem derrubar nada. Depois de definida, o secret passa a ser
obrigatório.

## Diferenças de comportamento em relação à Z-API

| | Z-API | WAHA |
| --- | --- | --- |
| Card de pré-visualização de link | Endpoint dedicado (`send-link`) | Não existe; o texto sai puro e o WhatsApp decide |
| Botões interativos | Nativos | Degradam para lista numerada (a GOWS não entrega botão de forma confiável) |
| Reconexão da sessão | O fornecedor cuida | **Sua.** Se cair, fica caída até alguém agir |
| Confirmação de entrega | `waitForDelivery` por polling | Não implementado |

## Limite conhecido

As ramificações de operador do webhook da Z-API — revisão humana, comprovante
de Pix, confirmação de atendimento e takeover pelo celular — **ainda não
existem** na rota do WAHA. Elas dependem do `receptionistPhone` e do
tratamento de `fromMe`, específicos daquele payload. O WAHA hoje atende o
caminho lead → IA → resposta, que é o escopo de lab/demo da ADR-010.

## Teto de números por servidor

O limite não é técnico, é de risco. Vários números conectando do mesmo IP de
datacenter é um dos padrões que a detecção lê como fazenda de contas. A
capacidade técnica da engine GOWS é de ~50 sessões em 2 vCPU / 4 GB, mas o
teto prudente por IP é muito menor e ainda **não está definido** — ver riscos
abertos na ADR-010. Não empilhe números além do lab sem decidir isso.
