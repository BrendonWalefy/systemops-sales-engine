# Recepcionista Comercial Autonoma

## Posicionamento

A SystemOps deve evoluir para uma recepcionista comercial autonoma para clinicas, treinada para converter leads em avaliacoes agendadas 24/7.

Ela nao deve ser apenas um copiloto que sugere respostas. O valor de mercado esta em operar o funil:

- responder rapido;
- qualificar interesse;
- contornar objecoes;
- consultar agenda;
- oferecer horarios;
- confirmar avaliacao;
- fazer follow-up;
- chamar humano quando houver risco.

## Autonomia Permitida

O agente pode agir sozinho quando:

- o lead cumprimenta;
- pergunta preco;
- pergunta sobre tratamento;
- pede horario;
- escolhe um horario oferecido;
- fica sem resposta;
- precisa receber lembrete de avaliacao.

## Handoff Obrigatorio

O agente deve parar e chamar humano quando:

- houver dor, inchaco, sangramento, urgencia ou sintoma sensivel;
- o lead pedir diagnostico;
- o lead pedir prescricao;
- houver irritacao;
- houver negociacao fora da politica;
- o tema sair do playbook.

## Estados da Conversa

```txt
new_lead
qualifying_interest
handling_price
collecting_schedule_preference
offering_slots
waiting_slot_confirmation
appointment_scheduled
handoff_required
follow_up_due
lost
```

## MVP de Validacao

Antes de plugar WhatsApp e Google Calendar reais, o produto deve provar a jornada com:

- WhatsApp simulado;
- agente mockado;
- agenda mockada;
- conversa multi-turno;
- resposta automatica;
- handoff em caso sensivel;
- custo estimado de IA e WhatsApp.

O criterio de validacao nao e "a resposta ficou bonita".

O criterio e:

> O fluxo autonomo aproxima o lead de uma avaliacao agendada com menos dependencia da recepcao?

