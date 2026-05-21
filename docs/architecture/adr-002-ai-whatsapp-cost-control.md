# ADR 002 - OpenAI, WhatsApp Oficial e Controle de Custos

## Status

Aceita para o piloto.

## Contexto

O piloto da SystemOps precisa validar valor comercial real para clinicas, sem criar risco operacional ou custo imprevisivel.

As duas integracoes mais sensiveis sao:

- IA para analisar conversas e sugerir respostas;
- WhatsApp para entrada e resposta aos leads.

## Decisao

Usaremos:

- OpenAI API como primeiro provedor de IA do piloto;
- WhatsApp Business Platform / Cloud API oficial como caminho recomendado de WhatsApp;
- tracking de consumo e custo desde o inicio.

## Por Que OpenAI

- Boa qualidade em portugues;
- boa capacidade de seguir schema estruturado;
- menor risco de respostas ruins em contexto comercial sensivel;
- SDK e documentacao maduros;
- custo estimado baixo quando usado de forma controlada.

## Por Que WhatsApp Oficial

- Menor risco de bloqueio do numero da clinica;
- melhor previsibilidade para produto comercial;
- webhooks e APIs oficiais;
- caminho mais defensavel para vender a SystemOps como solucao profissional.

Automacoes via WhatsApp Web, Baileys, whatsapp-web.js ou similares podem ser uteis para testes internos, mas nao devem ser base de produto comercial para clinicas.

## Controle de Custos

Cada execucao relevante deve registrar:

- `clinicId`;
- `provider`;
- `model`;
- `operation`;
- tokens de entrada;
- tokens de saida;
- custo estimado em micros de USD;
- data/hora.

Cada mensagem WhatsApp relevante deve registrar:

- `clinicId`;
- `category`;
- `direction`;
- `providerMessageId`;
- custo estimado em micros de USD;
- data/hora.

## Politicas Para o Piloto

- Rodar IA apenas em eventos importantes, nao em toda mensagem.
- Resumir conversa para reduzir tokens.
- Limitar execucoes por lead em uma janela curta.
- Preferir respostas dentro da janela de atendimento de 24h.
- Evitar campanhas outbound/marketing no piloto.
- Expor custo estimado por clinica.

## Consequencias

Boas:

- Qualidade melhor no agente de vendas;
- menor risco com WhatsApp;
- precificacao futura baseada em dados reais;
- visibilidade de margem desde o piloto.

Cuidados:

- OpenAI e WhatsApp geram custo variavel;
- templates WhatsApp podem exigir aprovacao;
- precos mudam e devem ser configuraveis;
- custo estimado deve ser reconciliado com fatura real depois.
