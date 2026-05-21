# Controle de Custos do Piloto

## Objetivo

Medir o custo variavel por clinica desde o primeiro piloto.

O objetivo nao e apenas economizar. E entender quanto custa gerar valor para a clinica e criar base para precificacao.

## Custos Monitorados

### IA

- execucoes do agente;
- modelo usado;
- tokens de entrada;
- tokens de saida;
- custo estimado;
- caso de uso: lead novo, perguntou preco, follow-up, handoff, resumo.

### WhatsApp

- mensagens recebidas;
- mensagens enviadas;
- categoria: service, utility, marketing, authentication;
- janela de 24h;
- custo estimado;
- provedor usado.

## Metas do Piloto

- IA abaixo de custo relevante por lead.
- WhatsApp majoritariamente inbound/service.
- Evitar marketing outbound no inicio.
- Medir custo por agendamento gerado.

## Indicadores

- custo de IA por lead;
- custo de WhatsApp por lead;
- custo variavel total por clinica;
- custo por consulta agendada;
- receita estimada recuperada;
- margem estimada por plano.

## Politica de Uso Inicial

O agente deve rodar quando:

- lead novo chegar;
- lead perguntar preco;
- lead pedir horario;
- lead tiver objecao clara;
- lead ficar parado;
- recepcao pedir analise manual.

O agente nao deve rodar automaticamente para mensagens triviais, agradecimentos ou duplicidades.

