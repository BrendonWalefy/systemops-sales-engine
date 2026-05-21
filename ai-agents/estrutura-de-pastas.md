# Estrutura Sugerida Para o Futuro App

Este projeto atual deve continuar como landing page e validação comercial.

Recomendação:

- `SystemOps`: landing page, marketing, SEO e validação.
- `systemops-app`: aplicação principal, agentes, dashboard, integrações e módulos.

## Estrutura Inicial do `systemops-app`

```txt
systemops-app/
  app/
    dashboard/
    leads/
    conversations/
    agents/
    settings/

  components/
    ui/
    layout/
    leads/
    conversations/
    agents/
    analytics/

  server/
    db/
    auth/
    services/
      leads/
      conversations/
      clinics/
      followups/
      analytics/
    agents/
      sales/
      shared/
    integrations/
      whatsapp/
      calendar/
      ads/

  domain/
    clinic/
    lead/
    conversation/
    agent/
    followup/
    campaign/
    roi/

  prompts/
    sales-agent/
      system.md
      developer.md
      response-schema.json
      examples.md

  evals/
    sales-agent/
      cases/
      rubrics.md
      expected-behavior.md

  docs/
    product/
    architecture/
    compliance/
```

## Por Que Separar Landing e App

### Landing

- muda rápido;
- foco em comunicação;
- deploy simples;
- SEO;
- validação comercial;
- não precisa carregar complexidade do produto.

### App

- terá autenticação;
- banco de dados;
- agentes;
- integrações;
- regras de negócio;
- segurança;
- auditoria;
- multi-clínicas.

Separar evita acoplamento cedo demais.

## Domínios Principais

### Clinic

Representa a clínica cliente.

Inclui:

- dados institucionais;
- tom de voz;
- regras comerciais;
- tratamentos;
- horários;
- equipe.

### Lead

Representa uma oportunidade comercial.

Inclui:

- origem;
- campanha;
- tratamento de interesse;
- status;
- temperatura;
- próxima ação.

### Conversation

Representa o histórico de mensagens.

Inclui:

- canal;
- mensagens;
- autor;
- timestamps;
- resumo;
- intenção;
- objeções.

### Agent

Representa agentes e suas recomendações.

Inclui:

- tipo de agente;
- contexto usado;
- resposta sugerida;
- confiança;
- motivo;
- decisão humana;
- resultado.

### Follow-up

Representa cadências e próximas ações.

Inclui:

- data;
- template;
- status;
- motivo;
- canal;
- resultado.

### ROI

Representa performance comercial.

Inclui:

- canal;
- campanha;
- custo;
- leads;
- agendamentos;
- conversões;
- receita estimada;
- receita recuperada.

