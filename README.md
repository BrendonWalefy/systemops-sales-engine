# SystemOps Core

Aplicacao principal da SystemOps.

O objetivo do produto e ajudar clinicas a converter melhor os leads que ja recebem, inicialmente em odontologia. A landing page fica em outro repositorio; este projeto concentra produto autenticado, dominio, agentes, integracoes, automacoes, agenda e metricas.

## Tese

Clinicas nao precisam apenas de mais leads. Elas precisam operar melhor os leads que ja recebem.

A SystemOps deve organizar a jornada comercial:

1. lead entra pelo WhatsApp;
2. sistema registra origem, conversa e status;
3. agente especialista em vendas analisa o contexto;
4. recepcao aprova ou edita a recomendacao;
5. Google Calendar ajuda a encontrar/agendar horario;
6. follow-up e resultado voltam para o core;
7. gestor enxerga conversao, perdas e ROI.

## Stack Proposta Para o MVP

- Next.js + TypeScript para app web.
- PostgreSQL como banco principal.
- Drizzle ORM para modelagem e migrations.
- Auth.js ou Supabase Auth para autenticacao.
- Google Calendar como primeira agenda integrada.
- WhatsApp como primeiro canal de entrada, via adapter.
- n8n self-hostado para automacoes operacionais.
- OpenAI API ou outro provedor LLM via porta de agente.

## Arquitetura

Este projeto usa uma organizacao inspirada em Clean Architecture:

- `src/domain`: entidades, value objects, contratos e regras puras.
- `src/application`: casos de uso e portas que orquestram o dominio.
- `src/infrastructure`: adapters externos, banco, APIs e provedores.
- `src/presentation`: app web, componentes e camada de interface.
- `prompts`: prompts versionados dos agentes.
- `evals`: casos de avaliacao dos agentes.
- `docs`: produto, arquitetura e compliance.

## Principio Central

O SystemOps Core deve ser a fonte oficial dos dados. Ferramentas como n8n, WhatsApp, Google Calendar e provedores de IA entram como adapters substituiveis.

