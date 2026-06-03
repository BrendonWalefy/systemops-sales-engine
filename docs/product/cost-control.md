# Controle de Custos

Objetivo: medir custo variavel por clinica sem depender de planilha ou estimativa manual.

## Custos Monitorados

### IA

Registrar por interacao:

- modelo;
- input tokens;
- output tokens;
- custo estimado;
- clinica;
- conversa;
- caso de uso.

Tabela principal: `ai_usage_costs`.

### WhatsApp

Registrar por mensagem:

- clinica;
- conversa;
- direcao;
- tipo;
- custo estimado quando disponivel.

Tabela principal: `whatsapp_message_costs`.

## Indicadores Esperados

- custo por conversa;
- custo por lead agendado;
- custo por clinica;
- margem por plano;
- volume de mensagens enviadas pela IA;
- volume de mensagens manuais.

## Regras de Produto

- Custos devem ser visiveis para owner antes de escalar para mais clinicas.
- Ambientes de QA devem poder desligar envio real e LLM real.
- Campanhas outbound nao devem ser ativadas sem controle explicito de limite e custo.
- Playbooks nao podem burlar limite financeiro; limites devem estar em codigo ou configuracao deterministica.
