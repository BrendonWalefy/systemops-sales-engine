# ADR 001 - Stack do MVP

## Status

Proposta inicial.

## Contexto

O MVP da SystemOps deve validar valor comercial para clinicas odontologicas com o menor custo possivel, mantendo base tecnica profissional para evoluir.

O primeiro fluxo real sera:

1. lead entra pelo WhatsApp;
2. SystemOps registra lead e conversa;
3. agente especialista em vendas recomenda resposta e proxima acao;
4. recepcao aprova/edita;
5. Google Calendar apoia agendamento;
6. resultado volta para metricas e aprendizado.

## Decisao

Usaremos:

- Next.js + TypeScript para aplicacao web.
- PostgreSQL como banco principal.
- Drizzle ORM para schema e migrations.
- Auth.js ou Supabase Auth para autenticacao.
- Google Calendar como primeira agenda.
- WhatsApp como primeiro adapter de canal.
- n8n self-hostado para automacoes operacionais.
- Provedor LLM atras de uma porta `SalesAgentGateway`.

## Ferramentas Gratuitas ou de Baixo Custo

- Desenvolvimento local com Node.js, TypeScript e PostgreSQL.
- n8n self-hostado para evitar custo inicial de Zapier/Make.
- Vercel Hobby ou alternativa similar para deploy inicial quando aplicavel.
- Supabase ou Neon em free tier para Postgres durante validacao.
- Google Calendar API para primeira integracao de agenda.

Observacao: IA e mensagens WhatsApp podem ter custo de uso. A arquitetura deve isolar esses provedores para controlar custo e permitir troca.

## Consequencias

Boas:

- MVP rapido sem microservicos.
- Dominio protegido de fornecedores externos.
- Caminho claro para trocar WhatsApp, agenda, auth ou IA.
- Estrutura pronta para novos canais de entrada.

Cuidados:

- Evitar colocar regra critica dentro do n8n.
- Evitar depender de API nao oficial de WhatsApp para produto comercial.
- Registrar recomendacoes da IA e decisoes humanas desde o inicio.
- Manter agenda propria fora do MVP, exceto se feedback do piloto provar necessidade.

