# Fluxo real atual

Referência: `origin/main == origin/develop == d8c0fd0`.

## Entrada Z-API

```text
POST /api/whatsapp/zapi
  → resolve a organização pela instância
  → normaliza e persiste inbound_event
  → enfileira message.process de forma idempotente
  → responde ao provider

message-worker
  → reivindica até 3 jobs
  → executa os jobs com Promise.all
  → ProcessMessageJobHandler marca inbound como processing
  → resolve política de automação e conteúdo
  → ConversationOrchestrator.handle()
  → marca inbound como processed

ConversationOrchestrator
  → registra/resolve lead, conversa e mensagem
  → adquire lease CAS em conversations.processing_until
  → faz guards de rajada/debounce
  → lê o último estado global
  → classifica intenção e aplica sobrescritas determinísticas
  → executa agenda/pipeline/mídia/handoff conforme o ramo
  → persiste a mensagem do agente
  → persiste outbound_message + job message.send
  → libera o lease no finally

sender
  → reivindica outbox
  → aplica safety/ordenação
  → entrega texto/áudio/mídia
  → somente depois aplica pipelineAdvance
  → marca outbox/job como concluído
```

O `message-worker` drena a fila de envio na mesma invocação depois do lote de
processamento. O cron separado do sender continua como fallback.

O dreno inline reduz a duração média da janela, mas não elimina a corrida: o lease da conversa já foi liberado antes de o sender aplicar `pipelineAdvance`.

## Entrada Meta Cloud API

```text
POST /api/whatsapp/webhook
  → aceita somente mensagem de texto
  → resolve organização por phone_number_id
  → chama ConversationOrchestrator.handle() diretamente
  → não persiste inbound_event
  → não cria message.process
```

Esse caminho não herda a idempotência, retry, métricas e recuperação do ingress Z-API.

## Estado e concorrência

- O worker processa até três jobs simultaneamente.
- O lease CAS serializa a maior parte do trabalho por conversa.
- O lease pertence ao processamento do turno, não à entrega.
- A transição diferida do pipeline viaja dentro do payload da outbox.
- `advancePipelineStep()` relê o último estado e insere outro estado sem `expectedRevision`, CAS ou `turnId`.
- Todos os tipos de estado usam o mesmo stream append-only; `getCurrentState()` retorna apenas a linha global mais recente.

Sequência problemática:

```text
turno A lê pipeline step N
turno A enfileira resposta com advance N+1
turno A libera lease
turno B adquire lease e ainda lê step N
sender entrega A e só então grava N+1
```

Para ocorrer em runtime, o turno B precisa entrar depois da liberação do lease e antes do avanço do sender. A produção possui dreno inline, porém a rede, fila, ordenação de outbox, retry e execução paralela mantêm essa janela aberta.

## Resultado do processamento inbound

`ProcessMessageJobHandler` ignora o retorno `{ replied }` do orquestrador. Se `handle()` absorver um erro e retornar `replied:false`, ou não responder por supersession/lease, o inbound ainda é marcado como `processed`. Exceções lançadas antes do retorno continuam seguindo a política normal de retry.

## Saída

### Caminhos na outbox

- resposta conversacional principal;
- lembrete de consulta ao lead;
- follow-up;
- pós-atendimento;
- expiração de depósito;
- recovery campaign;
- reativação;
- ações guiadas de pipeline.

### Caminhos diretos que permanecem em produção

- envio manual do operador;
- respostas operacionais dentro do webhook Z-API;
- notificações de comprovante/foto/atenção para recepcionista;
- resumo de agenda para staff;
- confirmação de decisão de depósito;
- recovery action manual;
- script operacional legado de recovery.

Portanto, a afirmação de fragmentação é válida, mas a lista do pacote está parcialmente desatualizada: lembrete do lead, follow-up e recovery cron já migraram para a outbox.

## Efeitos relevantes do orquestrador

Além de decidir texto, a classe atual:

- grava mensagens e estado;
- atualiza lead, temperatura e flags de atenção;
- reserva, confirma, remarca e cancela agenda;
- manipula depósito e revisão humana;
- seleciona e encaminha mídia;
- enfileira outbound;
- envia notificações diretas ao staff;
- registra custos;
- dispara push;
- controla debounce, supersession e lease.

Isso confirma o alto acoplamento, mas não justifica um rewrite. A extração deve ocorrer por seams preservando V1.

## Como uma regra de uma clínica alcança outra

O tenant é resolvido corretamente antes do processamento. O vazamento não ocorre
por consulta sem `clinicId`; ocorre depois, na decisão:

```text
mensagem + config do tenant
  → helpers universais no ConversationOrchestrator
  → regra/copy sem `appliesTo`
  → resposta aplicada à clínica corrente
```

Exemplos atuais:

- pedido fora do horário sempre promete avaliar exceção;
- “qual foto?” pode injetar a comparação Premium/Estratificada;
- depósito habilitado implica “avaliação gratuita”;
- nome do tratamento pode superar o `isAesthetic` cadastrado;
- um regex amplo reduz dental, saúde e estética ao mesmo
  `isClinicSegment=true`.

Portanto, tenancy de dados está majoritariamente presente, mas isolamento de
política conversacional ainda não está.

## Shadow atual

`shadowModeEnabled` é shadow de entrega, não shadow puro de engine:

- classificação e composição acontecem;
- mensagens simuladas são persistidas;
- o sender suprime o provider;
- `pipelineAdvance` ainda é aplicado;
- outros efeitos do turno podem ocorrer antes do sender.

Essa flag não pode ser reutilizada como `v2_shadow`.
