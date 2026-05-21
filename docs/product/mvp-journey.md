# Jornada Operacional do MVP

## Fluxo Principal

```txt
WhatsApp
  -> ChannelAdapter
  -> RegisterIncomingMessage
  -> Lead + Conversation + Message
  -> AnalyzeSalesConversation
  -> Recomendacao do agente
  -> Recepcao aprova ou edita
  -> Mensagem enviada
  -> Google Calendar sugere/cria horario
  -> Follow-up ou resultado
  -> Metricas
```

## Passo a Passo

1. O lead chama a clinica pelo WhatsApp.
2. O adapter de WhatsApp converte o evento externo para `IncomingChannelMessage`.
3. O caso de uso `RegisterIncomingMessage` cria ou atualiza o lead.
4. A conversa e a mensagem sao registradas no core.
5. O agente recebe contexto da clinica, playbook, lead e historico.
6. O agente retorna resposta sugerida, temperatura, objecao, proxima acao e risco.
7. A recepcao aprova, edita ou rejeita.
8. Se o lead quiser horario, o sistema consulta Google Calendar.
9. A recepcao confirma ou cria o agendamento.
10. Se o lead nao responder, o sistema cria follow-up.
11. O resultado volta para metricas e aprendizado.

## Pontos de Fallback

- Se WhatsApp API nao estiver pronta, a conversa pode ser cadastrada manualmente.
- Se Google Calendar nao estiver organizado, a clinica pode informar disponibilidade manual.
- Se IA sinalizar risco, o fluxo exige handoff humano.
- Se uma integracao falhar, o core mantem o estado e registra pendencia operacional.

## Sem Furos de Integracao

Para evitar furos, cada integracao deve ser tratada como adapter:

- WhatsApp nao cria regra de negocio.
- Google Calendar nao decide prioridade comercial.
- n8n nao define status oficial do lead.
- IA nao envia mensagem sozinha no MVP.

O SystemOps Core decide e registra o estado oficial.

