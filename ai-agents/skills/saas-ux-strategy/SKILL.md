---
name: saas-ux-strategy
description: Estrategia de UX e produto para SaaS premium de saude com IA. Use ao redesenhar ou revisar telas do SystemOps como dashboards, Smart Inbox, editores de playbook, configuracoes de IA, fluxos de setup, simuladores, paineis operacionais e qualquer interface que precise ficar mais clara, escalavel, AI-native, moderna, morphic/glass e menos poluida.
---

# SaaS UX Strategy

Use esta skill para transformar telas operacionais de clinicas em experiencias premium, claras e rapidas. O objetivo e reduzir carga cognitiva, aumentar confianca na IA e manter o SystemOps com cara de workspace AI-native, nao ERP antigo.

## Contexto Obrigatorio

Antes de propor ou implementar uma tela do SystemOps:

1. Leia `ai-agents/design-system-context.md` quando existir.
2. Preserve o stack e padroes do repo atual.
3. Use tokens e primitivas locais antes de inventar uma nova linguagem visual.
4. Priorize uma tela usavel e operacional, nao uma landing page.

## Workflow

1. **Auditar a tarefa do usuario**
   - Identifique quem usa a tela: dono da clinica, recepcao, operador ou gestor.
   - Defina a acao principal da tela em uma frase.
   - Remova ou rebaixe elementos que nao ajudam essa acao.

2. **Organizar a informacao**
   - Agrupe configuracoes por intencao: contexto, conhecimento, regras, testes, publicacao.
   - Coloque indicadores perto da area que explicam.
   - Use contadores, filtros e busca quando houver listas longas.

3. **Aplicar padrao AI-native**
   - Mostre se a IA esta ativa, sincronizada, pendente ou precisa de intervencao.
   - Evite fazer o usuario "trabalhar no chat"; ele deve monitorar, testar e intervir so quando necessario.
   - Diferencie claramente mensagens de lead, IA e operador humano.

4. **Aplicar morphism com disciplina**
   - Use superficies translucidas, borda sutil, blur e sombra suave para hierarquia.
   - Reserve glow/acento para foco, status e acao primaria.
   - Evite glass em tudo; a tela precisa continuar legivel e operacional.

5. **Verificar experiencia**
   - A primeira acao deve estar obvia sem texto explicativo longo.
   - Campos, botoes e estados precisam caber em desktop e mobile sem sobreposicao.
   - Scrollers internos devem existir em paineis fixos ou simuladores para nao roubar o scroll da pagina.

## Quando Ler Referencias

- Para paleta, superficies, status e componentes, leia `references/design-patterns.md`.
- Para editores de playbook, setup de IA e simuladores, leia `references/playbook-editor-patterns.md`.
- Para melhorar esta propria skill apos uso real, leia `references/skill-maintenance.md`.

## Padroes De Decisao

**Dashboard:** comece por ROI, conversao, tempo economizado e saude do funil.

**Inbox/monitoramento:** destaque IA ativa, handoff humano e temperatura do lead; mantenha o resto silencioso.

**Setup de IA:** use estrutura modular, versionamento, rascunho/publicado e teste lateral ou contextual.

**Listas longas:** use busca, filtros, contadores e edicao focada; evite mostrar todas as respostas abertas ao mesmo tempo.

**Chat de simulacao:** trate como laboratorio de teste do playbook, com prompts rapidos, estado da IA e historico rolando dentro do painel.
