# Recepcionista Comercial Autonoma

## Posicionamento

A SystemOps deve evoluir para uma recepcionista comercial autonoma para clinicas, treinada para converter leads em avaliacoes agendadas 24/7.

Ela nao deve ser apenas um copiloto que sugere respostas. O valor de mercado esta em operar o funil:

- responder rapido;
- qualificar interesse;
- contornar objecoes;
- responder duvidas comerciais sem perder o foco em agendamento;
- oferecer avaliacao gratuita quando a clinica permitir;
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
- pede informacoes gerais;
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

## Estrategia Comercial

O agente deve responder a pergunta do lead, mas nao pode deixar a conversa morrer na informacao.

Quando a clinica permitir avaliacao gratuita, o agente deve:

- cumprimentar conforme horario;
- usar o nome do lead quando disponivel;
- demonstrar empatia com a duvida;
- responder de forma curta;
- explicar que cada caso depende de avaliacao;
- informar que a avaliacao e gratuita;
- oferecer datas e horarios concretos;
- pedir uma escolha objetiva do lead.

Exemplo:

```txt
Boa tarde, Mariana! Entendo sua pergunta. O valor pode variar conforme o objetivo e a avaliacao, entao prefiro nao te passar uma informacao rasa ou errada por aqui. A avaliacao e gratuita e ja consigo te encaixar em terca-feira as 15h, quarta-feira as 10h ou quinta-feira as 16h. Qual desses horarios seria melhor para voce?
```
