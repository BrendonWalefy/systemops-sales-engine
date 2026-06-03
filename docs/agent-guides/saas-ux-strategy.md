# SaaS UX Strategy

Guia para agentes ou humanos que forem alterar UI do SystemOps. Ele substitui a antiga arvore `ai-agents/` e concentra apenas as regras que ainda ajudam o produto.

## Norte do Produto

SystemOps e um workspace operacional para clinicas que usam IA no atendimento comercial. A UI deve transmitir:

- confianca na IA;
- clareza operacional;
- pouca friccao para recepcao;
- leitura rapida para owner;
- sensacao de produto serio, nao demo ou landing page.

## Principios

1. Construir a tela util primeiro, nao uma apresentacao de marketing.
2. Preferir informacao densa e organizada a cards decorativos.
3. Mostrar o estado da IA de forma explicita: ativa, pausada, precisa de humano, erro, custo.
4. Separar configuracao, monitoramento e acao. Nao misturar tudo em um painel.
5. Usar texto curto, concreto e operacional.
6. Evitar efeitos visuais que dificultem leitura: blobs, orbs, gradientes pesados, glass excessivo.
7. Manter os fluxos principais confortaveis em mobile, pois a recepcao pode operar pelo celular.

## Padroes Por Area

### Dashboard

- KPIs devem responder perguntas reais: conversas, agendamentos, perdas, custo, follow-ups e atencao humana.
- Evitar hero grande. Dashboard abre direto com dados.
- Priorizar comparacao e tendencia, nao ilustracao.

### Inbox

- A lista deve deixar claro quem precisa de resposta agora.
- Conversas com IA pausada ou atencao humana devem ficar visualmente acima do ruido.
- Chat deve ter area de mensagem estavel, sem layout shift quando aparece status, erro ou loading.
- Acoes destrutivas ou de takeover devem ter estado claro e reversivel quando possivel.

### Agenda

- A agenda e ferramenta de trabalho. Priorizar densidade, horarios legiveis e conflitos visiveis.
- Profissionais, tratamentos e bloqueios precisam aparecer com contexto suficiente para decisao rapida.
- Nunca esconder indisponibilidade atras de microtexto.

### Playbook e IA

- O editor deve separar conteudo comercial de controles operacionais.
- Simulador e laboratorio, nao chat decorativo.
- Mostrar se a resposta veio de mock, sandbox ou LLM real quando estiver em modo de QA.
- Alteracoes de playbook nao podem prometer regra de negocio que o codigo nao garante.

### Owner

- Owner precisa ver risco e saude da operacao: clinicas com erro, volume, custo, configuracao incompleta e necessidade de acao.
- Drill-down deve explicar o problema antes de oferecer reset ou ajuste.

## Componentes

- Usar icones `lucide-react` quando houver icone adequado.
- Botoes de ferramenta devem preferir icone com tooltip.
- Cards devem ser simples, com raio curto e sem card dentro de card.
- Controles:
  - toggle para on/off;
  - segmented control para modos;
  - tabs para secoes equivalentes;
  - input/stepper/slider para numeros;
  - menu para opcoes.

## Linguagem

- Usar portugues claro e profissional.
- Evitar explicar a UI dentro da UI.
- Preferir "IA pausada" a "modo manual ativo".
- Preferir "Precisa de humano" a termos internos como `handoff`.
- Evitar promessas absolutas sobre diagnostico, tratamento ou resultado clinico.

## Checklist Antes de Finalizar UI

- Texto cabe no container em desktop e mobile.
- Estados vazios, erro, loading e sucesso existem.
- Acoes principais ficam acessiveis por teclado e toque.
- Layout nao muda de tamanho quando chega dado dinamico.
- Fluxo principal funciona sem depender de explicacao externa.
- `npm run verify` passa.
