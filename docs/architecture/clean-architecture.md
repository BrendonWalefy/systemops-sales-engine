# Clean Architecture

## Regra de Dependencia

As dependencias devem apontar para dentro:

```txt
presentation -> application -> domain
infrastructure -> application -> domain
```

O dominio nao importa Next.js, banco, SDKs, WhatsApp, Google Calendar ou provedor de IA.

## Camadas

### Domain

Contem conceitos centrais:

- Clinic;
- Lead;
- Conversation;
- Message;
- AgentRecommendation;
- CalendarSlot;
- Appointment.

### Application

Contem casos de uso:

- registrar mensagem recebida;
- analisar conversa de vendas;
- sugerir horarios;
- registrar decisao humana;
- agendar consulta;
- criar follow-up.

### Infrastructure

Contem detalhes externos:

- Drizzle/PostgreSQL;
- WhatsApp adapter;
- Google Calendar gateway;
- LLM gateway;
- n8n webhooks.

### Presentation

Contem Next.js, rotas, paginas e componentes.

## Decisao Importante

O SystemOps Core e a fonte oficial dos dados. Integracoes executam tarefas, mas nao devem decidir o estado principal do negocio.

