# Event-Driven Observability

## Correlacao

Os logs operacionais sao JSON por linha. Use os campos abaixo para seguir uma
mensagem sem depender de memoria da invocation:

- `traceId`: `inboundEventId` para processamento ou `outboundMessageId` para envio;
- `correlationId`: ID da mensagem no provedor, quando ja conhecido;
- `jobId`, `queue` e `workerId`: execucao duravel que tratou a etapa;
- `clinicId` e `conversationId`: tenant e conversa afetados;
- `durationMs`: tempo gasto na rota, no worker ou no handler.

O webhook registra `webhook.enqueued`; o worker de processamento registra
`job.processed`; o sender registra `job.sent`. Erros terminais e retries usam
`job.failed` com `status` e a causa serializada.

## Budgets Operacionais

| Sinal | Budget | Acao quando exceder |
| --- | --- | --- |
| Webhook ate `webhook.enqueued` | 500 ms p95 | verificar banco e resolucao de tenant |
| Job `message.process` pendente vencido | 10 min | alerta critico: worker/fila parada |
| Job `message.send` pendente vencido | 10 min | alerta critico: sender/fila parada |
| Job em `processing` | 5 min | alerta critico: invocation interrompida; o proximo worker recupera |
| Job em `dead` | 0 tolerados | alerta critico e avaliar replay seguro |
| Job pendente com erro e 3+ tentativas | 0 tolerados | alerta de falha repetida; inspecionar `lastError` |

Os limites acima sao intencionalmente conservadores para os workers atuais,
que sao acionados por cron a cada minuto e drenam poucos jobs por invocation.
Eles devem ser revistos antes de aumentar volume ou alterar a cadencia.

## Health E Alerta

`GET /api/health` inclui `queueHealth` e torna o status geral degradado quando
existir alerta critico de fila. O dashboard do owner e o digest operacional
diario tambem incluem os alertas da plataforma com origem `queue`.

Para diagnosticar uma mensagem:

1. procure pelo `correlationId` do provedor ou pelo `traceId` retornado no log;
2. encontre o `jobId` e confirme a transicao `job.claimed` -> terminal;
3. se houver retry, use `lastError` e `attempts` no job persistido;
4. para envio, confirme `job.sent` e o `providerMessageId` da outbox.
