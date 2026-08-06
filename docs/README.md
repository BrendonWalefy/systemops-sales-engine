# Documentação do SystemOps

Este diretório contém somente documentação que orienta o produto, a arquitetura e a operação atuais. O código e o schema prevalecem quando houver divergência.

## Comece aqui

| Documento | Responde a |
| --- | --- |
| [Features](features.md) | O que o produto já entrega? |
| [Arquitetura atual](architecture/current.md) | Como o sistema funciona hoje? |
| [Arquitetura alvo](architecture/target-architecture.md) | Quais patterns existem e quando evoluir? |
| [Diagramas](architecture/diagrams/README.md) | Como visualizar e editar a solução? |
| [GitHub Pages](solution-site/README.md) | Como gerar e publicar o portal visual? |

## Engenharia

- [Fontes de verdade](architecture/sources-of-truth.md): dono de cada categoria de dado e regra.
- [Replay e Decision Trace](architecture/replay-and-decision-trace.md): validação E2E, privacidade e observabilidade de decisões.
- [Contrato de fidelidade do replay](architecture/replay-fidelity-contract.md): critérios para uma execução representar produção.
- [Change control](operations/change-control.md): branches, testes, deploy e rollback.
- [Migrations](operations/migrations-baseline.md): baseline e fluxo seguro de schema.
- [Staging CI](operations/staging-ci-setup.md): teste de migrations em branch Neon descartável.
- [Controle de spend Vercel](operations/vercel-pro-spend-control.md): limites e alertas da plataforma.

## Operação

- [Onboarding de organização](operations/onboarding-clinica.md): criação, canal, validação e ativação.
- [LGPD e dados de saúde](compliance/lgpd-healthcare.md): requisitos mínimos de privacidade.

## Política de manutenção

- Estado atual fica nos documentos acima, nunca em handoff, prompt ou relatório pontual.
- Planos concluídos e auditorias temporárias devem virar código, teste ou decisão resumida; depois são removidos.
- Conteúdo, mídia, snapshots e conversas de clientes nunca são versionados.
- Estimativas de custo registram data, região, premissas e links oficiais.
- Toda mudança estrutural atualiza `README.md`, `architecture/current.md`, o diagrama e o GitHub Pages no mesmo PR.
