# Media Infrastructure

Decisões atuais para recebimento e envio de mídia no SystemOps.

## Estado atual

### Inbound

```text
Lead envia imagem / vídeo / áudio / documento
  -> Z-API webhook
  -> inbound_events
  -> ProcessMessageJobHandler
  -> RegisterIncomingMessage
  -> messages.media_url + media_type
  -> Inbox renderiza a mídia no ChatWindow
```

Tipos suportados:

- `image`
- `video`
- `audio`
- `document`

### Limite atual do inbound

As URLs de mídia entregues pela Z-API expiram depois de um tempo. Hoje isso é
aceito como tradeoff operacional: o inbox consegue operar e exibir mídia
recente, mas o sistema ainda não rehosta toda mídia inbound para histórico
permanente.

## Outbound de voz

Hoje a saída por voz já está integrada ao runtime real.

```text
ConversationOrchestrator ou cron resolve config de voz
  -> resolveClinicVoiceConfig(clinicId)
     -> clinic_modules (voice_tts / voice_elevenlabs)
  -> sendVoiceOrText()
  -> provider TTS sintetiza áudio
  -> upload temporário no Vercel Blob
  -> WhatsApp envia o áudio pela URL pública
  -> cleanup posterior do blob
```

### Fonte de verdade da voz

Saída por voz não é mais controlada por boolean solto em `clinics`.

O dono agora é:

- `clinic_modules` para ativação;
- `clinic_modules.config` para provider e parâmetros.

## Outbound de mídia editorial

```text
Playbook ativo contém mediaLibrary
  -> ResponseComposer usa tokens [MEDIA:id]
  -> ConversationOrchestrator resolve os IDs contra a biblioteca
  -> sender-worker / OutboundDeliveryService envia na ordem certa
```

Isso permite:

- texto + vídeo intercalados;
- áudio + vídeo na mesma resposta;
- pipeline por serviço com mídia declarativa.

## Onde cada dado mora

| O quê | Dono |
| --- | --- |
| Config de voz | `clinic_modules` |
| Biblioteca de mídia editorial | `playbook_versions.mediaLibrary` |
| Histórico da mensagem enviada | `messages` |
| Intenção de envio assíncrona | `outbound_messages` |
| Blob temporário de áudio | Vercel Blob |

## Riscos ainda abertos

1. Mídia inbound da Z-API não é persistida em storage durável por padrão.
2. Algumas automações de cron ainda enviam direto e não passam pela mesma
   outbox do pipeline principal.
3. Meta Cloud API continua sendo a rota natural quando o produto precisar de
   mídia com lifecycle mais controlado, templates aprovados ou botões nativos.

## Gatilhos de migração para Meta Cloud API

Migrar quando qualquer uma destas condições ficar forte o suficiente:

- custo operacional de manter muitas instâncias Z-API por tenant;
- necessidade de templates aprovados;
- necessidade de botões interativos nativos;
- necessidade de mídia com lifecycle mais controlado no provider.

## Próximas melhorias úteis

- rehosting opcional de mídia inbound relevante para histórico de longo prazo;
- unificação de reminders/follow-ups com a mesma outbox do pipeline principal;
- política explícita de retenção e limpeza para blobs temporários de áudio.
