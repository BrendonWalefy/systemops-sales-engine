# Task: Transcrição de Áudio via Whisper

Implemente transcrição de mensagens de áudio do WhatsApp via OpenAI Whisper no projeto SystemOps Core.

---

## CONTEXTO DO PROJETO

SaaS de recepcionista autônoma para clínicas. MVP em produção (piloto Ximendes Odontologia).
Stack: Next.js 14 App Router, TypeScript, Drizzle/Neon (Postgres), OpenAI, Z-API (WhatsApp), Vercel.

Clean Architecture:
- src/domain/ — entidades e interfaces (zero dependências externas)
- src/application/ports/ — interfaces de infraestrutura
- src/core/ — pipeline, orquestrador, IA
- src/infrastructure/ — implementações concretas
- src/app/api/ — rotas HTTP thin (apenas parse + delegate)

REGRA CRÍTICA: Toda a implementação deve ficar no adapter da Z-API e na camada de infraestrutura.
Zero alterações em IntentClassifier, ConversationOrchestrator ou ResponseComposer.

---

## PROBLEMA A RESOLVER

~30% dos leads brasileiros mandam áudio no WhatsApp. Hoje o sistema ignora completamente
mensagens de áudio (linha 131 em zapi/route.ts: `if (!body.text?.message) return OK`).
Lead envia áudio → IA não responde → lead perdido.

---

## O QUE CONSTRUIR

### 1. Port (interface)
Criar: `src/application/ports/transcription-gateway.ts`

```typescript
export type TranscriptionGateway = {
  transcribe(audioBuffer: ArrayBuffer, mimeType: string): Promise<string>;
};
```

### 2. Implementação Whisper
Criar: `src/infrastructure/adapters/ai/whisper-gateway.ts`

- Implementa `TranscriptionGateway`
- POST multipart para `https://api.openai.com/v1/audio/transcriptions`
- Usa `process.env.OPENAI_API_KEY` (já existe no projeto — usado por ResponseComposer)
- Parâmetros: `model: "whisper-1"`, `language: "pt"` (força português — melhora precisão)
- Timeout de 10s via `AbortController`
- Lança erro se resposta não for ok ou texto vier vazio

### 3. Extensão do tipo ZApiInboundPayload
Arquivo: `src/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter.ts`

Adicionar campo `audio` ao tipo `ZApiInboundPayload`:
```typescript
audio?: {
  audioUrl: string;
  mimeType: string;   // ex: "audio/ogg; codecs=opus"
  seconds?: number;
};
```

### 4. Detecção e transcrição no adapter Z-API
Arquivo: `src/app/api/whatsapp/zapi/route.ts`

Substituir o bloco atual (linha ~131):
```typescript
// ANTES — ignora tudo que não for texto:
if (!body.text?.message) {
  return new NextResponse("OK", { status: 200 });
}
```

Por lógica que:
1. Se `body.text?.message` existir → fluxo normal (sem mudança)
2. Se `body.audio?.audioUrl` existir → transcrever e continuar com o texto transcrito
3. Qualquer outra coisa (imagem, sticker, vídeo) → ignorar com `return OK`

Fluxo do áudio:
```
body.audio.audioUrl detectado
  → fetch(audioUrl, { signal: AbortSignal.timeout(5000) })  // download do áudio
  → arrayBuffer()
  → whisperGateway.transcribe(buffer, body.audio.mimeType)  // transcrição
  → messageText = "[áudio] " + textoTranscrito
  → segue para getOrchestrator().handle({ ..., messageText })

Fallback (qualquer erro em download ou transcrição):
  → sendTextMessage(body.phone, "Não consegui ouvir seu áudio. Pode me escrever? 😊")
  → log do erro
  → return new NextResponse("OK", { status: 200 })  // não reprocessar
```

IMPORTANTE: salvar `messageText` com prefixo `[áudio] ` para o operador ver na Inbox
que a mensagem veio de áudio, não de texto digitado.

---

## REGRAS DE IMPLEMENTAÇÃO

1. `OPENAI_API_KEY` já está disponível como env var — não criar nova var
2. Não usar biblioteca `openai` para Whisper — fazer fetch direto para a API (pattern já usado
   em outros adapters do projeto como GoogleCalendarGateway)
3. Download do áudio com timeout de 5s, transcrição com timeout de 10s — usar AbortController
4. Fallback deve sempre retornar HTTP 200 para a Z-API (evitar reprocessamento)
5. Não alterar o fluxo de mensagens fromMe (operador pelo celular) — esse bloco fica intacto
6. Não criar nova instância do WhisperGateway a cada requisição — instanciar uma vez fora
   do handler POST (mesmo padrão do `getOrchestrator()` já existente no arquivo)
7. A rota zapi/route.ts tem ~170 linhas atualmente — manter thin, extrair helper se necessário

---

## TESTES

Criar: `src/__tests__/AudioTranscription.test.ts`

Casos obrigatórios (usar Vitest — já configurado no projeto):

1. **Payload com áudio válido** → transcrição bem-sucedida → `messageText` prefixado com `[áudio] `
   → `getOrchestrator().handle()` chamado com o texto transcrito
2. **Falha no download do áudio** (fetch lança erro) → fallback disparado →
   `sendTextMessage` chamado com mensagem de fallback → retorna HTTP 200
3. **Whisper retorna string vazia** → tratado como falha → fallback disparado
4. **Whisper lança erro (timeout, 500)** → fallback disparado → HTTP 200
5. **Payload sem `audio` e sem `text`** (ex: imagem, sticker) → ignorado → HTTP 200
6. **Payload com `text.message`** → fluxo normal de texto, WhisperGateway nunca chamado

Para mocks: use `vi.mock` para `fetch` e para `ConversationOrchestrator`.
Padrão dos testes existentes está em `src/__tests__/ZApiWebhook.test.ts` — seguir o mesmo estilo.

---

## DEPLOY

1. Rodar `npx tsc --noEmit` — zero erros de TypeScript
2. Rodar `npm test` — todos os testes passando (76 existentes + novos de áudio)
3. Commitar com mensagem descritiva
4. Verificar que não há novas variáveis de ambiente necessárias (`OPENAI_API_KEY` já existe)
5. Push para `main` → Vercel faz deploy automático

Após deploy, validar em produção:
- Enviar um áudio curto para o número da Ximendes
- Confirmar que a IA responde normalmente em texto
- Confirmar que na Inbox a mensagem aparece com prefixo `[áudio] `
- Enviar mídia não-suportada (foto) → confirmar que é ignorada sem erro

---

## ARQUIVOS DE REFERÊNCIA (ler antes de começar)

- `src/app/api/whatsapp/zapi/route.ts` — ponto de integração principal
- `src/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter.ts` — tipo ZApiInboundPayload
- `src/infrastructure/adapters/calendar/google/google-calendar-gateway.ts` — padrão de fetch direto
  com AbortController e tratamento de erro (replicar esse estilo para o WhisperGateway)
- `src/__tests__/ZApiWebhook.test.ts` — padrão de testes a seguir
- `src/infrastructure/adapters/channels/whatsapp/whatsapp-sender.ts` — como usar sendTextMessage

---

## CHECKLIST FINAL

- [ ] `src/application/ports/transcription-gateway.ts` criado
- [ ] `src/infrastructure/adapters/ai/whisper-gateway.ts` criado e implementado
- [ ] `ZApiInboundPayload` extendido com campo `audio?`
- [ ] `zapi/route.ts` detecta e transcreve áudio antes de passar para o Orchestrator
- [ ] Fallback envia mensagem amigável e retorna HTTP 200
- [ ] Prefixo `[áudio] ` salvo na mensagem para rastreabilidade na Inbox
- [ ] 6 casos de teste escritos e passando
- [ ] `tsc --noEmit` sem erros
- [ ] `npm test` todos os testes verdes
- [ ] Commit + push para main
- [ ] Validação manual em produção com áudio real
