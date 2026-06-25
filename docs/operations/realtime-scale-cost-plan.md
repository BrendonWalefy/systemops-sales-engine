# Realtime, Escala E Custo

Data de referencia: 2026-06-23.

Objetivo: definir a arquitetura alvo para tempo real e jobs operacionais do SystemOps, com uma transicao compativel com o estagio atual do produto.

## Contexto Atual

- O produto esta em piloto com a clinica Ximendes.
- Ainda nao existe receita recorrente ativa para financiar uma expansao de infra.
- O problema atual nao e falta de feature de realtime; e a forma como ela esta implementada.
- Hoje o app usa polling frequente no Vercel para detectar mudancas em inbox, agenda e conversa aberta.
- Esse polling recalcula snapshots caros no servidor e aumenta invocacoes e `Fluid Active CPU` sem entregar a melhor UX possivel.

## Principios

- O banco continua sendo a fonte de verdade.
- O sistema decide e persiste; a UI apenas reage a eventos de estado.
- Realtime de UI e processamento assincrono sao problemas diferentes e nao devem dividir a mesma solucao.
- Antes de adicionar novos servicos pagos, devemos remover polling caro e desperdicio arquitetural.

## Arquitetura Alvo

### Camadas

1. `Vercel + Next.js`
   - HTTP, UI, server actions e endpoints sincronos.
2. `Postgres / Neon`
   - fonte de verdade de dados operacionais;
   - tabela de `outbox` para eventos de dominio;
   - contadores ou versoes por recurso para invalidacao barata.
3. `Worker dedicado`
   - consome `outbox`;
   - executa fanout de eventos;
   - faz retry, debounce, jobs e processamento fora do lifecycle do request HTTP.
4. `Realtime gerenciado`
   - canais por clinica e por conversa;
   - push de eventos para inbox, agenda e conversa aberta;
   - elimina polling constante do frontend.

### Separacao correta de responsabilidades

#### Jobs / mensageria

Usado para:

- follow-up dispatcher;
- fanout de notificacoes;
- debounce fora do request;
- retries de integracoes;
- processamento pesado ou demorado.

#### Realtime / pub-sub

Usado para:

- inbox;
- conversa aberta;
- agenda;
- badges e indicadores operacionais.

## Arquitetura Recomendada Por Estagio

### Estagio 0 — Piloto sem receita

Nao adicionar novos servicos pagos.

Objetivo:

- reduzir consumo atual;
- melhorar fluidez perceptivel;
- manter a conta quase inalterada.

Decisoes:

- continuar com `Vercel + Neon + Blob`;
- nao contratar `Ably`, `Pusher`, `Fly`, `Redis` ou fila externa ainda;
- corrigir o realtime atual usando versoes baratas no proprio banco.

### Estagio 1 — Primeiras clinicas pagantes

Quando houver receita suficiente para sustentar a base de operacao, adotar:

- `Ably Standard` para realtime;
- `1 worker always-on` pequeno em `Fly.io`;
- `outbox` no Postgres.

Objetivo:

- conversa aberta realmente fluida;
- inbox reagindo por evento;
- jobs fora do request HTTP;
- custo previsivel e baixo.

### Estagio 2 — Dezenas de clinicas ativas

Expandir a mesma arquitetura, sem trocar paradigma:

- mais canais por clinica e por conversa;
- 2o worker ou aumento pequeno de capacidade;
- afinacao do Neon por carga real.

Objetivo:

- escalar sem reescrever a plataforma;
- manter UX forte com baixo risco operacional.

## Estimativa De Custo Da Arquitetura Alvo

Estimativa em dolares mensais, baseada em precos oficiais consultados em 2026-06-23.

### Faixas de operacao

| Faixa | Perfil | Estimativa |
| --- | --- | ---: |
| Piloto / pre-receita | 1 clinica, baixo volume, sem realtime gerenciado | `US$ 20-60` |
| 10 clinicas | operacao inicial com uso diario | `US$ 80-130` |
| 30 clinicas | inbox e agenda usados o dia todo | `US$ 150-260` |
| 100 clinicas | carga forte e mais operadores simultaneos | `US$ 350-900` |

### Composicao esperada quando a arquitetura alvo entrar

| Componente | 10 clinicas | 30 clinicas | 100 clinicas |
| --- | ---: | ---: | ---: |
| `Vercel Pro + uso` | `US$ 20-40` | `US$ 25-50` | `US$ 40-90` |
| `Neon` | `US$ 20-30` | `US$ 60-100` | `US$ 180-700` |
| `Ably` | `US$ 29-35` | `US$ 30-40` | `US$ 40-80` |
| `Fly worker(s)` | `US$ 6-11` | `US$ 6-11` | `US$ 11-21` |
| `Blob / transferencia` | `US$ 2-10` | `US$ 5-20` | `US$ 15-50` |

## O Que Fazer Agora Sem Aumentar Custo

Esta e a recomendacao principal para o estagio atual.

### Ajuste recomendado

Trocar o modelo atual de `snapshot polling caro` por `version polling barato`, ainda dentro da stack atual.

### Como fica

Em vez de recalcular inbox e agenda completos a cada request de realtime:

- manter `inboxVersion` na clinica;
- manter `agendaVersion` na clinica;
- manter `messageVersion` por conversa;
- incrementar esses contadores em mutacoes relevantes;
- o frontend pergunta apenas pelas versoes;
- so busca dados completos quando uma versao muda.

### Ganhos esperados

- queda forte em `Function Invocations` pesadas;
- queda forte em `Fluid Active CPU`;
- conversa mais fluida, porque o app deixa de refazer snapshots inteiros para descobrir que nada mudou;
- nenhuma dependencia paga nova;
- arquitetura compativel com a futura migracao para `Ably`.

### Mudancas de produto/UX

#### Conversa aberta

- polling curto pode continuar por enquanto, mas apenas para versao da conversa;
- buscar mensagens completas apenas quando `messageVersion` mudar.

#### Inbox

- montar realtime apenas na rota do inbox;
- remover provider global do layout da area clinica;
- parar de recalcular snapshot inteiro em heartbeat.

#### Agenda

- usar a mesma estrategia de `agendaVersion`;
- agenda tolera alguns segundos de latencia sem degradar UX.

## Ordem Recomendada De Implementacao

1. Remover o `RealtimeEventsProvider` do layout global da area clinica.
2. Criar versoes baratas por clinica e por conversa.
3. Fazer endpoints de realtime retornarem apenas versoes.
4. Fazer inbox, agenda e conversa carregarem payload completo apenas em mudanca real.
5. Medir uso apos essa correcao.
6. So depois decidir se ja vale introduzir `Ably + worker`.

## Criterio De Decisao Para Subir Um Degrau De Infra

Adotar `Ably + worker` quando pelo menos um destes sinais aparecer:

- 3 ou mais clinicas com operadores ativos em paralelo durante a maior parte do dia;
- necessidade real de conversa aberta quase instantanea em varias abas simultaneas;
- jobs assincronos com retry e fanout comecarem a pressionar os requests HTTP;
- a economia de tempo operacional justificar gasto fixo mensal adicional.

## Decisao Recomendada Hoje

Para o momento atual do produto:

- nao aumentar custo fixo de infra;
- corrigir a arquitetura errada do polling;
- preparar o codigo para uma futura camada de pub/sub real;
- reavaliar a contratacao de realtime gerenciado quando a operacao deixar o estagio de piloto.

## Fontes Externas

- Vercel pricing: https://vercel.com/pricing
- Vercel Fluid Compute pricing: https://vercel.com/docs/functions/usage-and-pricing
- Vercel regional pricing (Sao Paulo): https://vercel.com/docs/pricing/regional-pricing/gru1
- Neon pricing: https://neon.com/pricing
- Ably pricing: https://ably.com/pricing
- Fly.io pricing: https://fly.io/docs/about/pricing/
