# Arquitetura alvo e evolução

Atualizado em 2026-08-06. Custos são estimativas mensais em `us-east-1`, sem impostos, câmbio, WhatsApp e consumo de IA. Valores em reais usam apenas a referência de **US$ 1 = R$ 5,50** e devem ser recalculados antes de contratar.

## Decisão executiva

O próximo passo **não é migrar para microsserviços nem Kafka**.

A evolução recomendada é:

1. medir e otimizar o monólito modular e a fila PostgreSQL;
2. separar a mensageria com SQS quando latência ou contenção justificar;
3. executar conversation e delivery workers fora do cron quando precisarem escalar de forma independente;
4. extrair bounded contexts por Strangler somente com ownership e SLO próprios;
5. adotar Kafka apenas quando houver streaming, replay e múltiplos consumidores independentes em escala.

Essa ordem preserva as garantias atuais sem pagar complexidade antes da necessidade.

## Onde estamos hoje

As notas abaixo são uma leitura qualitativa de aderência, não uma certificação de maturidade.

| Conceito | Aderência | Evidência e limite |
| --- | ---: | --- |
| Microsserviços | 3/10 | Há módulos e ports bem separados, mas um deploy e um banco compartilhado. |
| Arquitetura orientada a eventos | 8/10 | Webhook, inbox, jobs, workers, outbox e automações assíncronas; não existe event bus externo. |
| Kafka | 0/10 | Não instalado nem necessário no volume e fan-out atuais. |
| Mensageria | 7,5/10 | Semântica durável em PostgreSQL com claim, lease, retry e dedupe; falta broker gerenciado e isolamento de carga. |
| Outbox, idempotência e DLQ | 8/10 | Implementados no fluxo principal; Strangler ainda não foi aplicado formalmente. |
| Raciocínio arquitetural | 8,5/10 | Decisão proporcional ao estágio, boundaries claros, tenancy antecipada e regra “LLM entende; sistema decide”. |

### Patterns implementados

- **Transactional Inbox:** evento recebido e job `message.process` são persistidos atomicamente.
- **Transactional Outbox:** intenção de saída e job `message.send` são persistidos atomicamente.
- **Idempotent Consumer:** dedupe keys, unique constraints, leases e atualizações condicionais.
- **Retry com backoff:** falhas transitórias retornam para `pending` com nova data.
- **Dead Letter Queue lógica:** job terminal `dead`, inspeção pelo owner e resolução auditada.
- **State Machine:** estado conversacional persistido e explícito.
- **Saga de booking:** reserva, calendar gateway e persistência coordenados com compensação.
- **Ports and Adapters:** canal, calendário, IA, TTS, storage e repositórios atrás de contratos.

### Patterns ainda não aplicados

- **Strangler Fig:** não existe extração progressiva de um serviço em produção.
- **Event Bus externo:** não há SNS/EventBridge/Kafka para fan-out.
- **Database per Service:** o PostgreSQL permanece compartilhado.
- **CQRS completo:** há modelos de leitura específicos, mas não stores separados.

## Gatilhos para trocar a fila PostgreSQL

Adotar SQS quando **um gatilho crítico** ou **dois gatilhos operacionais** permanecerem por pelo menos duas semanas.

| Tipo | Gatilho sugerido |
| --- | --- |
| Crítico | p95 entre webhook e início do processamento acima de 30 s fora de incidente do provedor |
| Crítico | spike de campanha degrada o SLO das respostas inbound |
| Operacional | dead letters acima de 0,5% dos jobs em 7 dias |
| Operacional | locks/contensão de `jobs` afetam queries transacionais ou Home |
| Operacional | backlog não drena em até 5 min depois do pico |
| Operacional | workers precisam de escala/concurrency diferente da aplicação web |
| Operacional | manutenção da tabela `jobs` vira custo recorrente relevante |

Número de clientes sozinho não decide. Dez organizações intensivas podem justificar a mudança antes de cem organizações de baixo volume.

## Gatilhos para microsserviços

Extrair um bounded context somente quando todos os itens abaixo forem verdadeiros:

1. há owner técnico claro para o serviço;
2. ele possui SLO, escala ou janela de deploy diferente do restante;
3. a fronteira de dados e eventos está definida;
4. testes de contrato cobrem o adapter antigo e o novo;
5. o ganho esperado supera observabilidade, on-call, rede, CI/CD e consistência distribuída.

Bons primeiros candidatos:

- **Delivery Worker:** escala por volume do canal e isola falhas de provider/TTS.
- **Conversation Worker:** escala por latência e custo de LLM sem replicar UI.
- **Campaign/Automation Worker:** absorve picos sem competir com inbound.
- **Media Worker:** útil quando transcrição, geração ou rehosting se tornarem pesados.

UI, owner, configuração e catálogo devem permanecer juntos enquanto compartilharem o mesmo ritmo de mudança.

## Gatilhos para Kafka

Kafka passa a fazer sentido quando houver simultaneamente:

- fluxo sustentado na ordem de centenas de eventos por segundo;
- retenção e replay de eventos como requisito de produto/operação;
- pelo menos três a cinco consumidores independentes por evento;
- necessidade clara de particionamento, ordenação por chave e reprocessamento histórico;
- equipe capaz de operar schemas, compatibilidade, lag e incidentes do cluster.

Para commands e work queues, SQS é mais simples. Para fan-out de eventos de domínio em volume moderado, SNS/EventBridge + SQS é suficiente. Kafka não substitui automaticamente outbox nem idempotência.

## Arquitetura alvo incremental

```text
Lead / equipe
     |
     v
Vercel: UI + APIs finas + autenticação + tenant resolution
     |
     +--> PostgreSQL/Neon: dados, configuração e outbox
     |
     +--> SQS FIFO message.process ----> Conversation Worker
     |          | DLQ                       | regras + LLM + booking
     |          |                           v
     |          +<--------------------- PostgreSQL/outbox
     |
     +--> SQS FIFO message.send ------> Delivery Worker ----> canais
     |          | DLQ                    safety + TTS/mídia
     |
     +--> SQS Standard automations ---> Campaign/Automation Worker

Eventos de domínio confirmados
     -> EventBridge/SNS -> métricas, notificações e integrações independentes

Observabilidade comum: traceId/turnId, métricas, logs, alertas e dashboards
```

### Garantias que devem permanecer

- tenant resolvido antes de leitura/escrita;
- transactional inbox/outbox no mesmo banco da alteração de negócio;
- SQS transporta IDs e metadados mínimos, não payload clínico desnecessário;
- ordenação por `conversationId` onde a conversa exigir FIFO;
- consumidor idempotente e retry-safe;
- DLQ com inspeção, redrive controlado e auditoria;
- LLM não decide ações finais;
- `BookingService` e `ClinicTimezone` continuam como fronteiras obrigatórias.

## Estratégia Strangler

Para cada extração:

1. tornar a port atual a fronteira canônica;
2. publicar o mesmo contrato sobre SQS/HTTP interno;
3. executar shadow/canary sem efeitos externos;
4. rotear um tenant de teste para o novo worker;
5. comparar traces, latência, custo e efeitos;
6. ampliar por tenant;
7. remover o caminho antigo somente depois do rollback window.

O banco pode continuar compartilhado na primeira extração. Database per service só entra quando ownership, ciclo de vida e consistência estiverem claros; dividir tabelas cedo cria transações distribuídas sem benefício.

## Custos estimados

### Infraestrutura mensal

| Etapa | Componentes adicionais | Incremento estimado | Total central indicativo* |
| --- | --- | ---: | ---: |
| Atual | Vercel Pro + Neon usage-based | — | US$ 35–130 (R$ 190–715) |
| 1. SQS + Lambda | 3 filas, DLQs e consumers serverless | US$ 0–25 | US$ 40–160 (R$ 220–880) |
| 2. Workers dedicados | 2–3 tasks pequenas no ECS/Fargate, logs e rede | US$ 35–120 | US$ 90–300 (R$ 495–1.650) |
| 3. Bounded services | mais tasks, EventBridge/SNS, observabilidade e ambientes | US$ 100–400 | US$ 200–700 (R$ 1.100–3.850) |
| 4. Kafka gerenciado | MSK Serverless + partições + tráfego + consumers | US$ 600–1.500+ | US$ 800–2.200+ (R$ 4.400–12.100+) |

\* Não inclui Z-API/Meta por organização, tokens de LLM/TTS, suporte, impostos, tráfego fora da região nem engenharia. O uso real prevalece.

Premissas:

- Vercel Pro custa US$ 20/mês com crédito de uso incluído.
- Neon Launch cobra por CU-hour; o gasto varia com autoscaling, storage e retenção.
- SQS possui 1 milhão de requests/mês no free tier; uma mensagem normalmente gera várias operações.
- Lambda possui 1 milhão de requests e 400 mil GB-s no free tier; tempo de LLM pode favorecer containers long-lived conforme o tráfego.
- duas tasks Fargate Linux de 0,25 vCPU/0,5 GB 24x7 custam aproximadamente US$ 18 apenas de compute; logs, IPv4, transferência e outros serviços elevam o total.
- MSK Serverless possui cobrança-base por cluster-hour; só essa parcela fica em torno de US$ 548/mês em 730 horas, antes de partições, dados e storage.

### Esforço de engenharia

| Mudança | Faixa inicial | Trabalho contínuo |
| --- | ---: | --- |
| Instrumentar SLOs e capacidade | 3–7 dias | baixo |
| Migrar jobs para SQS + DLQ | 1–3 semanas | baixo/médio |
| Separar conversation e delivery workers | 3–6 semanas | médio |
| Extrair primeiro bounded context com Strangler | 4–8 semanas | médio/alto |
| Introduzir Kafka com governança | 6–12 semanas | alto |

As faixas pressupõem uma pessoa experiente, cobertura existente e rollout por tenant. Compliance, rede privada, multi-região e on-call 24x7 ampliam prazo e custo.

## Plano por estágio

### Agora

- manter o monólito modular;
- medir queue lag, duração, retries, dead letters e custo por organização;
- definir SLO de inbound e delivery;
- garantir retenção/limpeza de jobs e índices;
- manter interfaces de queue e channel desacopladas.

### Ao atingir os gatilhos da fila

- introduzir SQS por trás da port de job queue;
- usar FIFO por conversa apenas onde a ordem for obrigatória;
- criar DLQs e runbook de redrive;
- preservar a outbox no PostgreSQL;
- canary por organização e rollback para o adapter PostgreSQL.

### Ao atingir os gatilhos de deploy/escala

- mover delivery, conversation e automations para workers independentes;
- aplicar Strangler por port e tenant;
- publicar eventos de domínio para consumidores de métricas/notificação;
- manter configuração e transação de negócio no núcleo até existir motivo para separar dados.

### Apenas em escala de streaming

- executar benchmark SQS/EventBridge versus Kafka;
- definir schemas versionados, retention, partitions e replay;
- projetar operação de lag, rebalancing e disaster recovery;
- aprovar o piso de custo antes da contratação.

## Referências de preço

Consultadas em 2026-08-06:

- [Vercel Pricing](https://vercel.com/pricing)
- [Neon Pricing](https://neon.com/pricing)
- [Amazon SQS Pricing](https://aws.amazon.com/sqs/pricing/)
- [AWS Lambda Pricing](https://aws.amazon.com/lambda/pricing/)
- [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- [Amazon MSK Pricing](https://aws.amazon.com/msk/pricing/)

Antes de aprovar a migração, recalcular no [AWS Pricing Calculator](https://calculator.aws/) com região, tráfego e retenção reais.
