# Agente Especialista em Vendas

## Papel

O agente especialista em vendas é o primeiro agente central da SystemOps.

Ele deve ajudar clínicas a converter leads vindos de WhatsApp, Instagram, Facebook, Google Ads e campanhas em consultas agendadas.

## Primeira Versão: Copiloto

Na primeira versão, o agente não precisa enviar mensagens automaticamente.

Ele deve:

- analisar a conversa;
- identificar intenção;
- classificar o lead;
- sugerir resposta;
- sugerir próxima ação;
- recomendar follow-up;
- indicar quando chamar humano.

## Objetivos

- Reduzir leads sem resposta.
- Melhorar qualidade das respostas.
- Aumentar agendamentos.
- Padronizar abordagem comercial.
- Criar follow-up consistente.
- Gerar dados para medir ROI.

## Entradas

O agente deve receber:

- dados da clínica;
- playbook comercial;
- tratamento de interesse;
- origem do lead;
- histórico da conversa;
- status atual;
- regras de tom e segurança.

## Saídas

O agente deve retornar:

- diagnóstico comercial da conversa;
- temperatura do lead;
- objeção principal;
- resposta sugerida;
- próxima ação;
- follow-up sugerido;
- motivo da recomendação;
- nível de confiança;
- alerta de handoff, se necessário.

## Exemplo de Saída Estruturada

```json
{
  "lead_temperature": "morno",
  "stage": "perguntou_preco",
  "main_objection": "preco",
  "suggested_reply": "Entendo sua dúvida. O valor pode variar conforme a avaliação e o objetivo do tratamento. Posso te ajudar a agendar uma avaliação para a doutora entender seu caso e te passar uma orientação mais precisa?",
  "next_action": "tentar_agendamento",
  "follow_up": "Se não responder em 4 horas, enviar lembrete curto reforçando a avaliação.",
  "handoff_required": false,
  "confidence": 0.82
}
```

## Critérios de Handoff

Encaminhar para humano quando:

- lead pede diagnóstico;
- lead relata dor, emergência ou sintoma sensível;
- lead pede preço fora da política;
- lead está irritado;
- lead pede negociação especial;
- lead quer falar com profissional específico;
- lead mostra intenção alta e precisa fechar horário.

## Limites

O agente não deve:

- diagnosticar;
- prometer resultado;
- prescrever;
- inventar preço;
- criar desconto fora da regra;
- dizer que é humano;
- pressionar de forma agressiva;
- ignorar LGPD e consentimento.

## Métricas

- Tempo médio para primeira resposta.
- Leads classificados.
- Respostas sugeridas aceitas.
- Taxa de agendamento.
- Leads recuperados por follow-up.
- Conversões por canal.
- Receita estimada gerada.

## Evolução

1. Copiloto manual.
2. Copiloto com templates e classificação automática.
3. Follow-up assistido.
4. Agente semi-autônomo com aprovação.
5. Agente autônomo para perguntas comuns.
6. Otimização por performance e ROI.

