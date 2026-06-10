---
name: feature-media-infrastructure
description: Infraestrutura de mídia — TTS, vídeos do doutor, fotos de leads; portas, adapters e plano de migração para Meta Cloud API
metadata:
  type: project
---

IMPLEMENTADO 2026-06-08: infraestrutura base de mídia para WhatsApp.

**Why:** Doutor da Ximendes quer enviar vídeos de procedimentos para leads fecharem. TTS de voz também planejado. Fotos recebidas de leads eram descartadas silenciosamente.

**O que foi implementado:**
- `messages.media_url` + `messages.media_type` no schema (migration 0013_media_support.sql — aplicar em prod)
- `MediaType = "image" | "video" | "audio" | "document"` em channel-adapter.ts e conversation.ts
- `ZApiChannelAdapter.receive()` agora parseia image/video/audio/document do webhook Z-API
- `OutgoingChannelMessage` tem `mediaUrl`, `mediaType`, `mediaCaption` opcionais
- `sendZApiMediaMessage()` em zapi-channel-adapter.ts — envia qualquer tipo de mídia via Z-API (exige URL pública)
- `sendMediaMessage()` em whatsapp-sender.ts — roteador por provider (Z-API ou Meta)
- Port `TtsGateway` em `src/application/ports/tts-gateway.ts`
- Port `StorageGateway` em `src/application/ports/storage-gateway.ts`
- `OpenAiTtsGateway` em `src/infrastructure/adapters/ai/tts/openai-tts-gateway.ts`
- `VercelBlobStorageGateway` em `src/infrastructure/adapters/storage/vercel-blob-storage-gateway.ts`
- `@vercel/blob ^2.4.0` instalado
- Docs completos em `docs/architecture/media-infrastructure.md`

**Pendente (próximos passos documentados em media-infrastructure.md):**
- P-MEDIA-1: integrar TTS no Orchestrator (config `voiceResponseEnabled` por clínica)
- P-MEDIA-2: UI do Inbox para exibir mídia inbound
- P-MEDIA-3: biblioteca de mídia no Playbook (URLs de vídeo do doutor)
- P-MEDIA-4: limpeza automática de blobs TTS após envio
- Aplicar migration 0013 em produção

**Gatilho de migração para Meta Cloud API:** +5 clínicas ativas, ou necessidade de botões interativos, ou custo Vercel Blob > R$30/mês. Ver detalhes em docs/architecture/media-infrastructure.md.

**How to apply:** Antes de integrar TTS no Orchestrator, aplicar migration 0013 em prod. Vídeos do doutor não precisam de storage — URL vai no playbook.
