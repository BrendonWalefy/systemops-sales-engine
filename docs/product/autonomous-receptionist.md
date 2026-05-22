# Recepcionista Comercial Autônoma

## Posicionamento

A SystemOps deve evoluir para uma recepcionista comercial autônoma para clínicas, treinada para converter leads em avaliações agendadas 24/7.

Ela não deve ser apenas um copiloto que sugere respostas. O valor de mercado está em operar o funil:

- responder rápido;
- qualificar interesse;
- contornar objeções;
- responder dúvidas comerciais sem perder o foco em agendamento;
- oferecer avaliação gratuita quando a clínica permitir;
- consultar agenda;
- oferecer horários;
- confirmar avaliação;
- fazer follow-up;
- chamar humano quando houver risco.

## Autonomia Permitida

O agente pode agir sozinho quando:

- o lead cumprimenta;
- pergunta preço;
- pergunta sobre tratamento;
- pede informações gerais;
- pede horário;
- escolhe um horário oferecido;
- fica sem resposta;
- precisa receber lembrete de avaliação.

## Handoff Obrigatório

O agente deve parar e chamar humano quando:

- houver dor, inchaço, sangramento, urgência ou sintoma sensível;
- o lead pedir diagnóstico;
- o lead pedir prescrição;
- houver irritação;
- houver negociação fora da política;
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

## MVP de Validação

Antes de plugar WhatsApp e Google Calendar reais, o produto deve provar a jornada com:

- WhatsApp simulado;
- agente mockado;
- agenda mockada;
- conversa multi-turno;
- resposta automática;
- handoff em caso sensível;
- custo estimado de IA e WhatsApp.

O critério de validação não é "a resposta ficou bonita".

O critério é:

> O fluxo autônomo aproxima o lead de uma avaliação agendada com menos dependência da recepção?

## Estratégia Comercial

O agente deve responder a pergunta do lead, mas não pode deixar a conversa morrer na informação.

Quando a clínica permitir avaliação gratuita, o agente deve:

- cumprimentar conforme horário;
- usar o nome do lead quando disponível;
- demonstrar empatia com a dúvida;
- responder de forma curta;
- explicar que cada caso depende de avaliação;
- informar que a avaliação é gratuita;
- oferecer datas e horários concretos;
- pedir uma escolha objetiva do lead.

Exemplo:

```txt
Boa tarde, Mariana! Entendo sua pergunta. O valor pode variar conforme o objetivo e a avaliação, então prefiro não te passar uma informação rasa ou errada por aqui. A avaliação é gratuita e já consigo te encaixar em terça-feira às 15h, quarta-feira às 10h ou quinta-feira às 16h. Qual desses horários seria melhor para você?
```
