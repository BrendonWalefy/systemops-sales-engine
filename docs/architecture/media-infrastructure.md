# Media Infrastructure

Decisões de arquitetura para envio e recebimento de mídia (áudio TTS, vídeos do doutor, fotos de leads).

## Estado atual (Z-API + Vercel Blob)

### Fluxo de recebimento (inbound)

```
Lead envia foto/vídeo/áudio no WhatsApp
        ↓
Z-API webhook → /api/whatsapp/zapi
        ↓
ZApiChannelAdapter.receive() — resolve mediaUrl + mediaType
        ↓
RegisterIncomingMessage — salva no messages.media_url + media_type
        ↓
Inbox mostra indicador de mídia (TODO — fase futura de UI)
```

Tipos suportados: `image`, `video`, `audio`, `document`.

**Limitação atual:** URLs hospedadas pela Z-API expiram (~24h). Suficiente para exibir no Inbox em tempo real, não adequado para histórico de longo prazo. Aceitar como tradeoff até migração para Meta Cloud API.

### Fluxo de áudio TTS (outbound)

```
Orchestrator decide enviar resposta em áudio
        ↓
OpenAiTtsGateway.synthesize() → ArrayBuffer
        ↓
VercelBlobStorageGateway.upload() → URL pública (blob.vercel-storage.com/...)
        ↓
sendMediaMessage(to, url, "audio", config)
        ↓
Z-API send-audio com a URL
        ↓
StorageGateway.delete(url) — limpeza após confirmação de envio
```

### Fluxo de vídeo do doutor (outbound)

```
Clínica cadastra URL de vídeo no Playbook (campo mediaLibrary — TODO)
        ↓
IA decide enviar o vídeo (ex: lead pergunta sobre procedimento)
        ↓
sendMediaMessage(to, videoUrl, "video", config, caption)
        ↓
Z-API send-video com a URL pública
```

**Sem storage necessário para vídeos** — a URL fica no playbook, hospedada pelo doutor onde preferir (Google Drive público, Loom, qualquer CDN).

## Portas (interfaces estáveis)

| Port | Localização |
|---|---|
| `TtsGateway` | `src/application/ports/tts-gateway.ts` |
| `StorageGateway` | `src/application/ports/storage-gateway.ts` |
| `MediaType` | `src/application/ports/channel-adapter.ts` |

## Adapters disponíveis

| Adapter | Provider | Quando usar |
|---|---|---|
| `OpenAiTtsGateway` | OpenAI TTS | Padrão atual |
| `VercelBlobStorageGateway` | Vercel Blob | Padrão atual (app no Vercel) |

## Próximos passos (por ordem de prioridade)

### P-MEDIA-1 — Integrar TTS no Orchestrator
Adicionar a decisão "texto ou áudio?" baseada em config da clínica (`voiceResponseEnabled boolean` no schema). O Orchestrator chama `TtsGateway` → `StorageGateway` → `sendMediaMessage`. Gatilho: quando o doutor pedir a feature de voz ativa.

### P-MEDIA-2 — UI do Inbox para mídia inbound
Exibir foto/vídeo/áudio recebidos de leads no Inbox. Os dados já chegam no banco (`media_url`, `media_type`), falta apenas renderizar no frontend.

### P-MEDIA-3 — Biblioteca de mídia no Playbook
Permitir que a clínica cadastre URLs de vídeo com título e tags de procedimento. A IA usa como base para decidir qual vídeo enviar. Armazenado em `playbook_versions.config` ou tabela dedicada.

### P-MEDIA-4 — Limpeza automática do Vercel Blob
Após envio do áudio TTS confirmado, deletar o blob. Pode ser feito inline ou via cron diário limpando blobs com mais de 1h.

---

## Gatilho de migração para Meta Cloud API

Migrar quando **qualquer uma** destas condições for verdadeira:

### Gatilho técnico (prioridade alta)
- **+5 clínicas ativas** — o custo operacional de gerir instâncias Z-API por clínica supera o custo de migrar para Meta Business API centralizada.
- **Necessidade de botões interativos nativos** — Z-API não entrega botões nativos no plano atual; Meta Cloud API sim.
- **Necessidade de templates aprovados** (campanhas proativas, lembretes formais) — exige WABA (WhatsApp Business Account) que só existe na Meta Cloud API.

### Gatilho de custo
- Volume mensal de armazenamento de áudio TTS ultrapassar R$30/mês no Vercel Blob. A Meta Cloud API aceita upload binário direto (sem storage externo), eliminando esse custo.

### O que muda na migração

| | Hoje (Z-API) | Meta Cloud API |
|---|---|---|
| Envio de texto | `send-text` | `POST /messages type=text` |
| Envio de áudio | URL pública obrigatória | Upload binário → `media_id` |
| Envio de vídeo | URL pública obrigatória | Upload binário → `media_id` |
| Recebimento de mídia | URL no webhook (expira) | `media_id` → busca URL permanente |
| Storage gateway | Necessário para TTS | Eliminado para TTS |
| Buttons/templates | Não disponível | Disponível |

**Impacto no código:** apenas os adapters de infraestrutura mudam (`zapi-channel-adapter` → `meta-channel-adapter`, `whatsapp-sender`). Ports, domain, Orchestrator e use cases não tocam.

### Estimativa de esforço de migração
- Novo webhook handler Meta: ~2 dias
- `MetaChannelAdapter` com suporte a mídia via `media_id`: ~3 dias
- Aprovação WABA + número Business: tempo externo (~1-2 semanas)
- Testes E2E com número real: ~1 dia

Total técnico: ~1 semana de desenvolvimento, 1-2 semanas de processo Meta.
