# Neon: 35 dias de compute ininterrupto sem cliente nenhum (22/08/2026)

Investigação e remediação do consumo de CU-horas do Neon com o produto
praticamente parado. Este documento é o registro da evidência; o código da
remediação está na branch `perf/inbox-latency-and-neon-compute`.

## O que foi observado

Painel do Neon, ciclo de 01/08 a 22/08:

| Métrica | Valor |
| --- | --- |
| Compute | 255,54 CU-horas |
| Armazenamento | 0,11 GB |
| Transferência | 0,46 GB |
| Compute primário | Ativo |

A desproporção entre compute e armazenamento é o primeiro sinal: 0,11 GB de
dados não justificam 255 CU-horas de processamento.

## Causa raiz: PROVADA

O compute de produção nunca suspendeu. Não é "acordado com frequência" — é
**continuamente ativo**.

Evidência 1 — o processo do Postgres:

```sql
select pg_postmaster_start_time();
-- 2026-07-18T00:22:52.657Z   (lido em 2026-08-22, 35 dias depois)
```

Evidência 2 — a API do Neon, endpoint `ep-dawn-scene-acf6l8u5`
(branch `production`):

```
current_state: "active"
started_at:    "2026-07-18T00:22:52Z"
suspend_timeout_seconds: 0        # 0 = padrão da plataforma = 300 s
autoscaling_limit_min_cu: 0.25
```

Evidência 3 — o histórico de operações do projeto (200 operações, até
26/07) não contém **nenhum** `suspend_compute` nem `start_compute` para
`ep-dawn-scene-acf6l8u5`. Os endpoints das branches de replay
(`ep-icy-river`, `ep-billowing-water`, `ep-muddy-lab`…) têm vários pares.
Ou seja: o mecanismo de autosuspend funciona no projeto; só este endpoint
nunca chega a ficar inativo.

Evidência 4 — a aritmética fecha. `active_time_seconds` da branch de
produção no ciclo: 1.830.022 s = 508,3 h, contra 509,7 h decorridas —
**99,7 % do período**. `compute_time_seconds` / `active_time_seconds` =
0,50, ou seja meia CU em média enquanto de pé; 0,5 × 24 h × 21,2 dias =
254 CU-horas, contra as 255,54 cobradas.

### Por que não suspende

O autosuspend do Neon conta **inatividade**. Qualquer consulta reinicia o
temporizador. O `vercel.json` tinha dois crons de 1 em 1 minuto:

```
/api/cron/message-worker   * * * * *
/api/cron/sender-worker    * * * * *
```

Com a fila vazia, um tick desses **ainda assim** consulta o banco. Medido em
`pg_stat_statements` (que estava coletando desde 18/07 — a extensão não
estava criada, mas a biblioteca já estava pré-carregada, então os contadores
são retroativos aos 35 dias):

| Consulta | Chamadas em 35 d | Por minuto | Origem |
| --- | --- | --- | --- |
| `update jobs set status… where locked_at < $` | 102.786 | 2,03 | `recoverStaleJobs`, um por worker |
| `with claimable_job … for update skip locked` | 108.725 | 2,14 | `claimNextJob`, um por worker |
| `select id, payload from outbound_messages … not exists(jobs)` | 75.099 | 1,48 | `listOutboundWithoutJob` |
| `select id from inbound_events … not exists(jobs)` | 37.554 | 0,74 | `listInboundWithoutJob` |

≈ 6,4 consultas por minuto, ~9.200 por dia, **com zero trabalho a fazer**.
O temporizador de 300 s nunca chegou perto de vencer.

E não havia trabalho: nenhuma clínica tinha `auto_reply_enabled = true`
além das de QA/Lab, e **nenhuma** tinha `operational_status = 'active'`
(Vitalli e Ximendes estão `paused`; NC Beauty, Lab e QA estão `test`;
Maycon está `prospect`).

### O que NÃO era a causa (verificado, não suposto)

- **Vazamento de conexão.** O driver é `@neondatabase/serverless` sobre HTTP
  (`drizzle-orm/neon-http`): cada consulta é uma requisição independente, não
  há conexão de longa duração para vazar.
- **Preview usando o banco de produção.** `DATABASE_URL` está com target
  `production` apenas na Vercel — implantações de preview não recebem a
  variável e nem conseguem conectar.
- **Monitor externo batendo em `/api/health`.** A consulta que só essa rota
  emite tem 625 chamadas em 35 dias (~18/dia): é uso manual, não um monitor.
- **Jobs falhando em repetição.** `jobs` tem 8.010 + 1.797 `done` e 10
  `failed`; nenhum `pending` represado.
- **CI/GitHub Actions.** O smoke E2E usa o webhook público, não o banco.
- **Peso das consultas.** Do tempo total de execução medido, ~96 % é do
  próprio monitoramento interno do Neon (`pg_stat_activity`,
  `neon_perf_counters`, exporters), que só roda **porque** o compute está de
  pé. É consequência, não causa.

## Remediação implementada

Na branch `perf/inbox-latency-and-neon-compute` (custo recorrente adicional:
**$0** — nenhum serviço novo, nenhum plano alterado):

1. **O webhook acorda o worker.** Ao gravar um job novo, os webhooks da Z-API
   e da Meta chamam `/api/cron/message-worker?ack=1` dentro de `after()`. O
   worker responde 202 na hora e drena em `after()`, no orçamento da própria
   invocação. O cron deixa de ser o caminho normal da resposta — vira rede de
   segurança. Efeito colateral desejado: até 60 s a menos de espera para o
   lead.
2. **Grade de acordar de 10 minutos.** Todos os 22 crons passam a disparar em
   minutos múltiplos de 10. A união deles abre **6 janelas por hora** em vez
   de manter o compute de pé continuamente. `CronScheduleGrid.test.ts` trava a
   grade.

### Efeito esperado

O que se paga é `janelas_por_hora × duração_da_janela`. A janela é o
`suspend_timeout` (mais o tempo do próprio trabalho, desprezível quando não
há o que fazer).

| Configuração | Janelas/h | Ciclo de atividade | CU-horas/mês a 0,25 CU |
| --- | --- | --- | --- |
| Hoje (cron de 1 min, timeout 300 s) | — | ~100 % | ~255 (observado) |
| Grade de 10 min, timeout 300 s | 6 | ~50 % | ~90 |
| Grade de 10 min, timeout 60 s | 6 | ~10 % | ~18 |

A média de 0,5 CU observada também deve cair na direção do mínimo de 0,25:
metade dela é o monitoramento interno que só existe enquanto o compute está
de pé.

Estas são **estimativas derivadas do ciclo de atividade**, não medições.
A medição real exige a janela de 24 h descrita abaixo.

## Ação de configuração pendente (precisa de aprovação)

Reduzir o autosuspend do endpoint de produção de 300 s (padrão) para 60 s.
É o que leva a economia de ~65 % para ~93 %. Não foi aplicado: é uma escrita
em infraestrutura de produção.

| | |
| --- | --- |
| Recurso | endpoint `ep-dawn-scene-acf6l8u5`, projeto `odd-voice-79423969` |
| Valor anterior | `suspend_timeout_seconds: 0` (= padrão da plataforma, 300 s) |
| Valor novo | `suspend_timeout_seconds: 60` |
| Por quê | A janela de atividade aberta por cada tick de cron passa de 5 min para 1 min; com 6 janelas/hora, o ciclo de atividade cai de ~50 % para ~10 % |
| Efeito financeiro | ~90 → ~18 CU-horas/mês (estimativa; ver tabela acima) |
| Risco | Um cold start (~0,5 s) na primeira consulta depois de 1 min de ociosidade total. O teto do poll do Inbox é 60 s, então uma aba aberta mantém o compute quente; quem paga o cold start é um poll de fundo, não um clique |
| Alternativa conservadora | `120` — a aba aberta nunca encosta na janela, e o ciclo de atividade fica em ~20 % (~36 CU-horas/mês) |
| Rollback | `PATCH` do mesmo campo de volta para `0`; efeito imediato, sem migração e sem perda de dado |

```bash
curl -X PATCH \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"endpoint":{"suspend_timeout_seconds":60}}' \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/endpoints/ep-dawn-scene-acf6l8u5"
```

Aplicar **depois** que a branch estiver em produção: antes disso os crons de 1
minuto continuam impedindo qualquer suspensão, e o ajuste não tem efeito
nenhum (nem bom nem ruim).

## Alteração já feita no banco

`create extension if not exists pg_stat_statements` no banco de produção.
A biblioteca já estava pré-carregada pelo Neon e coletando; faltava só a view.
É observabilidade pura, aditiva, sem migração e sem tocar em dado de cliente —
e é o instrumento da verificação abaixo. Para desfazer:
`drop extension pg_stat_statements;`.

## Verificação em 24 h

O consumo do Neon tem atraso de agregação. Não confunda remediação
implementada com redução observada. Depois do deploy da branch:

**1. O compute passou a suspender?** É a checagem que responde sim ou não.

```sql
select pg_postmaster_start_time(), now();
```

Se `pg_postmaster_start_time()` passar a ser recente e mudar entre duas
leituras separadas por mais de 10 minutos, o compute está reiniciando — ou
seja, está suspendendo. Se continuar em 2026-07-18, a remediação não pegou.

**2. Os pares de suspender/acordar aparecem no histórico?**

```bash
curl -s -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/operations?limit=200" \
| python3 -c "import json,sys; [print(o['created_at'], o['action']) for o in json.load(sys.stdin)['operations'] if o.get('endpoint_id')=='ep-dawn-scene-acf6l8u5']"
```

Esperado: pares `suspend_compute` / `start_compute` aparecendo ao longo do dia.
Hoje não há nenhum.

**3. O ciclo de atividade caiu?** Medida quantitativa, precisa de 24 h.

```bash
curl -s -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches" \
| python3 -c "import json,sys; b=[x for x in json.load(sys.stdin)['branches'] if x['name']=='production'][0]; print('active_s', b['active_time_seconds'], 'cpu_s', b['compute_time_seconds'])"
```

Anote `active_time_seconds` no deploy e 24 h depois. A diferença dividida por
86.400 é o ciclo de atividade do dia. Hoje esse número é 0,997. A meta com
timeout de 300 s é ~0,5; com 60 s, ~0,1.

Atenção: `active_time_seconds` é acumulado do **ciclo de faturamento**, então
o que vale é a diferença entre duas leituras, nunca o valor absoluto.

**4. As consultas por minuto caíram?**

```sql
select calls, query from pg_stat_statements
where query like 'update "jobs" set%locked_at%' order by calls desc limit 3;
```

Duas leituras separadas por uma hora. Hoje o delta é ~122 chamadas/hora
(2,03/min); com a grade de 10 minutos deve cair para ~12/hora.

## O que sobra depois disso

O poll do Inbox (`/api/inbox/check`) toca o banco a cada 15–60 s enquanto uma
aba está aberta — por desenho, e só enquanto alguém está de fato olhando. Com
o autosuspend em 60 s isso mantém o compute de pé durante o expediente do
operador, que é exatamente quando ele deve estar de pé. Não é desperdício, e
não foi mexido.
