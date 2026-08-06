# SystemOps Core

> Plataforma de inteligência comercial e operacional com IA que entende a demanda, organiza a operação, automatiza jornadas e otimiza conversão e receita.

[Aplicação](https://app.systemops.com.br) · [Arquitetura navegável](https://brendonwalefy.github.io/systemops-sales-engine/) · [Diagrama editável](docs/architecture/diagrams/systemops-current-architecture.drawio)

## O que o produto faz

O SystemOps conecta conversas, dados, agenda, campanhas e equipe em uma operação comercial única. A plataforma recebe mensagens do WhatsApp, identifica a intenção do lead, aplica a estratégia da organização, conduz a jornada até o agendamento e transforma cada interação em contexto operacional e oportunidade mensurável. A equipe supervisiona exceções pelo Inbox e usa a Home para acompanhar funil, agenda, receita e saúde da operação.

O objetivo é dar às empresas capacidade para entender o que acontece na jornada comercial, organizar a execução, automatizar rotinas repetíveis e otimizar continuamente conversão, produtividade e crescimento de faturamento.

Fluxo principal:

```text
WhatsApp
  -> webhook autenticado e resolução do tenant
  -> inbox durável + job de processamento
  -> orquestrador + regras determinísticas + LLMs
  -> agenda, pipeline, handoff ou campanha
  -> outbox durável + job de envio
  -> safety gate + WhatsApp
```

Princípio central:

> O LLM entende e verbaliza. O sistema decide.

Modelos classificam intenção, transcrevem áudio e compõem texto. Código determinístico decide tenant, autorização, disponibilidade, booking, estado, handoff, retry, limites e envio.

## Features atuais

- Especialista comercial com IA: contexto persistido, classificação de intenção, qualificação e condução por texto, áudio e mídia.
- Inbox e handoff: IA ativa/pausada, takeover humano, resposta manual e notificações.
- Agenda: calendário interno, Google Calendar opt-in, bloqueios, reserva e prevenção de double booking.
- Pipeline por serviço: conteúdo, vídeo, perguntas, coleta de foto e oferta de slots.
- Campanhas: segmentação, rascunho por IA, revisão humana, aprovação, ensaio e disparo seguro.
- Automações: follow-up, recuperação, lembrete D-1, pós-atendimento e expiração de sinal.
- Home: funil, volume, agenda, receita, filas acionáveis e saúde do canal.
- Configuração: playbook versionado, tratamentos, profissionais, módulos, mídia e simulador.
- Owner: onboarding, blueprint, qualidade, custos, alertas, dead letters e saúde multi-tenant.
- Qualidade: testes determinísticos, replay sanitizado e Decision Trace sem conteúdo sensível.

O catálogo detalhado está em [docs/features.md](docs/features.md).

## Arquitetura atual

O runtime é um **monólito modular em Next.js** com processamento **orientado a eventos e assíncrono**, sem Kafka ou broker externo. O PostgreSQL armazena dados de negócio e também implementa inbox, jobs e outbox.

| Tema | Estado atual |
| --- | --- |
| Microsserviços | Não. Um deploy modular reduz custo e complexidade operacional. |
| Event-driven | Sim, no fluxo de mensagens e automações duráveis. |
| Kafka | Não utilizado; o volume e o número de consumidores ainda não justificam seu custo. |
| Mensageria | Fila durável em PostgreSQL; sem SQS, SNS ou RabbitMQ hoje. |
| Inbox / Outbox | Implementados com persistência e enqueue atômicos. |
| Idempotência | Dedupe keys, constraints, leases, revisão de estado e efeitos retry-safe. |
| Retry / DLQ | Backoff, status terminal `dead`, painel e ações auditadas de reprocessamento/descarte. |
| Strangler | Não aplicado formalmente; será usado somente ao extrair um bounded context. |

A análise de maturidade, os gatilhos de migração e os custos estimados estão em [Arquitetura alvo e evolução](docs/architecture/target-architecture.md).

### Camadas

| Camada | Local | Responsabilidade |
| --- | --- | --- |
| Domain | `src/domain/` | Entidades, value objects e contratos de repositório |
| Application | `src/application/` | Use cases, ports, jobs e serviços de aplicação |
| Core | `src/core/` | Conversa, agenda, state machine e inteligência |
| Infrastructure | `src/infrastructure/` | Drizzle, canais, calendário, IA, storage, push e observabilidade |
| App | `src/app/` | UI, route handlers, server actions e crons HTTP |

### Stack

| Categoria | Tecnologia |
| --- | --- |
| Web | Next.js 16, React 19, TypeScript 5.8 |
| Dados | PostgreSQL serverless no Neon, Drizzle ORM / Kit |
| IA | OpenAI e Anthropic por caso de uso; Whisper; múltiplos providers de TTS |
| WhatsApp | Z-API principal e Meta Cloud API compatível |
| Agenda | Agenda interna e Google Calendar opt-in |
| Assíncrono | `inbound_events`, `jobs`, `outbound_messages` e workers |
| Storage e entrega | Vercel, Vercel Blob, Resend e Web Push |
| Observabilidade | Sentry, métricas operacionais e Decision Trace sanitizado |
| Testes | Vitest, CI e replay E2E isolado |

## Execução local

Requisitos: Node.js 22+, npm e PostgreSQL compatível com a `DATABASE_URL`.

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Workers locais:

```bash
npm run dev:workers
```

Comandos principais:

```bash
npm run verify          # schema check + lint + typecheck + testes
npm run verify:agenda   # suíte focada em agenda e timezone
npm run db:generate     # gera migration a partir do schema
npm run db:migrate      # aplica migrations
npm run build           # build de produção
```

Configuração compartilhada de infraestrutura fica em `.env.local`. Configuração que varia por organização — canal, agenda, playbook, catálogo, módulos, limites e usuários — fica no banco. Consulte [.env.example](.env.example) e [fontes de verdade](docs/architecture/sources-of-truth.md).

## Documentação essencial

- [Índice da documentação](docs/README.md)
- [Arquitetura atual](docs/architecture/current.md)
- [Arquitetura alvo, patterns, gatilhos e custos](docs/architecture/target-architecture.md)
- [Diagramas e arquivo Draw.io](docs/architecture/diagrams/README.md)
- [Features existentes](docs/features.md)
- [Fontes de verdade](docs/architecture/sources-of-truth.md)
- [Replay e Decision Trace](docs/architecture/replay-and-decision-trace.md)
- [Change control e deploy](docs/operations/change-control.md)
- [Onboarding de organização](docs/operations/onboarding-clinica.md)
- [Migrations](docs/operations/migrations-baseline.md)
- [LGPD e dados de saúde](docs/compliance/lgpd-healthcare.md)

## Fluxo de contribuição

`main` é produção e `develop` é integração:

1. criar branch focada a partir de `develop` atualizado;
2. implementar e testar a mudança;
3. executar `npm run verify`;
4. abrir PR para `develop` e validar CI/preview;
5. promover `develop` para `main` somente após QA e checks verdes.

As regras completas estão em [AGENTS.md](AGENTS.md).
