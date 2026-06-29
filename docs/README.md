# SystemOps Docs

Esta pasta contém apenas documentação que ainda deve orientar manutenção,
operação, arquitetura ou produto. Históricos de execução, prompts entregues a
agentes e planos já implementados não devem voltar a ser tratados como fonte de
verdade.

## Arquitetura

- [Arquitetura atual](architecture/current.md)
- [Diagramas de arquitetura](architecture/diagrams/README.md)
- [Arquitetura alvo 2.0](architecture/target-architecture.md)
- [Infraestrutura de mídia](architecture/media-infrastructure.md)
- [Fontes de verdade por tipo de dado](architecture/sources-of-truth.md)

## Operação

- [Change control e deploy safety](operations/change-control.md)
- [Onboarding de clínica](operations/onboarding-clinica.md)
- [Baseline de migrations](operations/migrations-baseline.md)
- [Controle de spend Vercel Pro](operations/vercel-pro-spend-control.md)

## Produto e Expansão

- [Estratégia de calendário](product/calendar-strategy.md)
- [Prontidão multi-segmento](product/multi-segment.md)
- [Posicionamento](product/positioning.md)
- [Controle de custos](product/cost-control.md)
- [Playbook comercial](product/sales-playbook.md)

## Compliance

- [LGPD e saúde](compliance/lgpd-healthcare.md)

## Guias para agentes

- [Template de mapeamento por clínica](agent-guides/clinic-playbook-template.md)
- [SaaS UX Strategy](agent-guides/saas-ux-strategy.md)

## O que não deve voltar

- Prompts soltos de implementação que descrevem uma entrega já feita
- Handoffs antigos com checklist concluído
- Roadmaps de piloto que contradizem a produção atual
- Exec logs, TODOs de sprint e checklists já consumidos
- Diagramas XML antigos quando a fonte viva já está em Markdown ou scripts
- Configuração de clínica por env
- Worktrees ou caches locais de ferramentas de IA
