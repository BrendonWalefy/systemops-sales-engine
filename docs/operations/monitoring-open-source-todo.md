# TODO — Monitoramento Open Source

## Objetivo

Complementar o health operacional do app com observabilidade de plataforma, sem transformar o banco da aplicação em ferramenta de logs, traces e uptime.

## O que fica no app

- saúde operacional por clínica;
- alertas de negócio e de canal;
- recheck manual para operação;
- incidentes visíveis no owner.

## O que deve sair do app

- retenção e busca de logs;
- rastreamento de exceções;
- monitoramento de uptime externo;
- execução e atraso de cron;
- tracing e correlação entre requests.

## Stack open source sugerida

### Opção 1 — Mais pragmática

- `Uptime Kuma` para uptime e heartbeat dos crons.
- `Grafana + Loki` para centralização e busca de logs.
- `GlitchTip` para exceptions estilo Sentry com stack traces e agrupamento.

### Opção 2 — Base mais completa para crescer

- `Grafana` como camada de visualização.
- `Loki` para logs.
- `Tempo` para traces.
- `Mimir` ou `Prometheus` para métricas.
- `Uptime Kuma` para checks externos e heartbeat de jobs.

## Próximos passos recomendados

1. Subir `Uptime Kuma` primeiro e monitorar:
   - `/api/health`
   - heartbeat do `channel-health-alert`
   - heartbeat do `conversation-analytics`
2. Centralizar logs do runtime em `Loki`.
3. Adicionar `GlitchTip` ou stack equivalente para exceptions.
4. Só depois instrumentar traces com OpenTelemetry se o volume justificar.

## Critério de sucesso

- falha de canal vira alerta no app;
- falha de infra vira alerta na ferramenta externa;
- cron atrasado gera heartbeat perdido;
- time consegue distinguir problema de negócio vs problema de plataforma em minutos.
