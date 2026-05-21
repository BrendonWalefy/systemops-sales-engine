# SystemOps Core - Visao de Solucao

## Tese do Produto

A SystemOps deve ajudar clinicas a vender melhor com os leads que ja recebem.

O problema principal nao e apenas gerar mais leads. Muitas clinicas perdem receita porque a recepcao demora, responde sem metodo, esquece follow-up, nao registra motivos de perda e nao conecta atendimento com agenda e ROI.

## Papel da SystemOps

A SystemOps deve ser o centro de operacao comercial da clinica:

- centralizar leads e conversas;
- organizar o funil comercial;
- orientar a recepcao com um agente especialista em vendas;
- sugerir respostas e proximas acoes;
- acionar follow-ups;
- conectar com agenda;
- medir agendamentos, perdas, recuperacoes e ROI.

## Primeiro Agente

O primeiro agente deve ser um especialista em vendas para clinicas odontologicas.

Na primeira versao, ele deve atuar como copiloto:

- classificar temperatura do lead;
- identificar intencao e objecao;
- sugerir resposta;
- recomendar proxima acao;
- indicar follow-up;
- sinalizar handoff humano;
- evitar diagnostico, prescricao e promessa de resultado.

A autonomia deve vir depois, quando houver dados de aprovacao, seguranca e resultado.

## Agenda

Recomendacao: nao criar uma agenda propria completa no MVP.

O caminho mais forte e:

1. Usar Google Calendar como primeira integracao de agenda.
2. Criar uma camada de "agenda inteligente" dentro da SystemOps.
3. Permitir disponibilidade manual como fallback se a clinica ainda nao estiver organizada no Google Calendar.
4. So depois evoluir para agenda propria opcional.

O objetivo da agenda inteligente nao e competir com calendarios no inicio. E ajudar a vender:

- encontrar horarios disponiveis;
- priorizar slots vazios;
- lembrar confirmacoes;
- sugerir encaixes;
- recuperar leads quando houver buracos na agenda;
- medir se o lead virou consulta.

## Uso do n8n

O n8n faz sentido como camada de automacao e integracao.

Ele pode:

- receber webhooks;
- enviar notificacoes;
- integrar com WhatsApp, email, calendario e planilhas;
- acionar lembretes;
- executar fluxos operacionais.

Ele nao deve ser a fonte oficial dos dados.

Dados criticos, regras de negocio, status de lead, historico, recomendacoes da IA, decisoes humanas e metricas devem ficar no SystemOps Core.

## Entrada de Leads no MVP

O primeiro canal real deve ser WhatsApp.

Mesmo assim, a arquitetura deve ter uma porta de entrada generica para aceitar outros canais depois:

- Instagram;
- Meta Ads;
- Google Ads;
- formulario da landing;
- telefone;
- indicacao;
- importacao manual.

A SystemOps deve normalizar tudo para um modelo interno unico:

- lead;
- canal de origem;
- campanha;
- conversa;
- mensagens;
- status;
- responsavel;
- proxima acao.

Assim, o produto comeca resolvendo o canal mais importante para clinicas, mas nao nasce preso ao WhatsApp.

## MVP Recomendado

1. CRM simples de leads.
2. WhatsApp como primeiro canal de entrada.
3. Playbook da clinica.
4. Copiloto de vendas.
5. Follow-up assistido.
6. Google Calendar como primeira agenda integrada.
7. Metricas basicas de conversao.

## Desenho

O desenho editavel da solucao esta em:

- `docs/architecture/systemops-solution.drawio`
