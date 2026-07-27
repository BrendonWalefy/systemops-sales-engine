# Pendências de conversas — 19/07/2026

## Escopo validado

### 1. Lembrete de agendamento manual — Ximendes

**Diagnóstico confirmado:** não era apenas falta do telefone. No caso inspecionado, o
paciente possuía telefone, mas o agendamento manual não havia criado uma conversa
WhatsApp. O cron dependia dessa conversa para ordenar a mensagem na outbox e, por
isso, pulava o lembrete.

**Ajuste:**

- o formulário exige um WhatsApp válido;
- números brasileiros digitados como DDD + número recebem o DDI 55;
- leads antigos sem DDI são reaproveitados, sem duplicação;
- o agendamento manual garante a conversa WhatsApp antes de criar a consulta;
- o cron recupera agendamentos históricos criando a conversa técnica de forma
  idempotente quando há uma identidade WhatsApp válida.

### 2. Pedido de sábado/data específica — Tatiana, Vitalli

**Diagnóstico confirmado:** a frase com data e a palavra “horário” era confundida com
pergunta sobre o horário de funcionamento. Isso desviava o fluxo antes da busca na
agenda.

**Ajuste:** datas explícitas e pedidos com “agenda/agende/agendamento” são tratados
como busca de disponibilidade. A resposta de funcionamento só prevalece quando a
pessoa pergunta explicitamente se a clínica abre ou funciona naquele dia. O
lookahead mínimo da Vitalli fica em 30 dias para alcançar datas como 08/08.

### 3. Avaliação clínica e sinal de R$ 30 — Nataly, Vitalli

**Diagnóstico confirmado:** havia três fontes descrevendo os mesmos R$ 30 de formas
incompatíveis. A organização configurava corretamente o depósito, mas o tratamento
“Avaliação Clínica Inicial” também possuía preço de R$ 30 e o playbook usava a
expressão “sinal da avaliação”. Isso permitia ao modelo apresentar o valor como custo
da avaliação.

**Ajuste:** a avaliação passa a ser explicitamente gratuita. Os R$ 30 são somente o
sinal para reservar o horário e são abatidos do procedimento, nunca taxa, preço ou
custo da avaliação. A correção remove o preço conversável do tratamento e mantém o
depósito como única fonte canônica.

### 4. Pré-análise e decisão do doutor

**Diagnóstico:** o pedido A2 era criado, mas a IA não ficava efetivamente travada e
podia continuar respondendo questões clínicas. Além disso, depender apenas dos
botões do provedor deixava a mensagem sem instrução útil quando o WhatsApp não
renderizava os botões.

**Ajuste:**

- um caso pendente pausa a IA sem expiração automática;
- novas mensagens do paciente são anexadas ao mesmo caso e notificadas ao doutor;
- o doutor recebe primeiro texto simples com código do caso, nome do paciente e as
  quatro decisões, seguido da tentativa de envio dos botões;
- a mensagem ao paciente informa que a análise está com o doutor, sem inventar
  diagnóstico ou avançar para agenda;
- pedidos clínicos combinados, como fechar espaços com pouca resina e clareamento,
  acionam revisão humana determinística.

### 5. Fluxo de menu e imagens — Henrique

**Diagnóstico:** foram encontrados quatro problemas independentes: seleção numérica
após expiração do menu, estado posterior contaminando replay de mensagem anterior,
tratamentos filhos sem pipeline próprio e CTA de nova agenda mesmo com um horário já
reservado aguardando sinal.

**Ajuste:**

- seleção de slot recém-expirado atualiza a disponibilidade, sem virar menu órfão;
- o estado é lido na data da mensagem durante replay;
- tratamentos filhos podem herdar explicitamente o pipeline editorial do tratamento
  pai, fazendo “Lente Estratificada” e “Lente Premium” usarem as mídias de “Lentes em
  Resina Composta”;
- durante uma reserva aguardando sinal, respostas informativas preservam o horário
  já separado e não oferecem uma segunda agenda.

## Evidências de verificação

- replay local sem escrita externa: **8 de 8 cenários aprovados**;
- testes direcionados de conversa, revisão humana, preço, identidade WhatsApp e
  agenda: **115 aprovados**;
- suíte obrigatória de agenda: **84 aprovados**;
- verificação completa: **165 arquivos, 1.549 testes aprovados e 10 ignorados**;
- typecheck, lint e consistência das migrations aprovados; o lint preserva sete
  avisos preexistentes e não possui erro.

## Ordem segura de publicação

1. Revisar e aprovar o diff, incluindo a migration `0075`.
2. Publicar a aplicação e aplicar a migration que adiciona a origem de pipeline.
3. A correção pontual foi aplicada uma única vez; o script foi removido depois da execução.
4. Reexecutar o script em dry-run e confirmar que nenhuma alteração permanece.
5. Fazer replay controlado e validar uma mensagem real de decisão do doutor.
6. Monitorar lembretes manuais, criação de casos A2 e respostas de disponibilidade.

Até essa sequência ser aprovada e executada, a configuração incorreta da Vitalli
continua em produção; o script foi validado somente em modo de leitura.
