# Jornada Operacional do MVP

## Fluxo Principal

```txt
WhatsApp
  -> ChannelAdapter
  -> RegisterIncomingMessage
  -> Lead + Conversation + Message
  -> AnalyzeSalesConversation
  -> Decisao autonoma do agente
  -> Regra de seguranca valida execucao
  -> Mensagem enviada automaticamente ou handoff
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
6. O agente decide resposta, proxima acao, risco e possibilidade de execucao automatica.
7. Se for baixo risco, o sistema envia a resposta automaticamente.
8. Se o lead quiser horario, o sistema consulta Google Calendar.
9. Se o lead escolher horario, o sistema cria ou pre-agenda a avaliacao.
10. Se o lead nao responder, o sistema cria follow-up.
11. O resultado volta para metricas e aprendizado.

## Pontos de Fallback

- Se WhatsApp API nao estiver pronta, a conversa pode ser cadastrada manualmente.
- Se Google Calendar nao estiver organizado, a clinica pode informar disponibilidade manual.
- Se IA sinalizar risco, o fluxo exige handoff humano e nao executa orientacao clinica.
- Se uma integracao falhar, o core mantem o estado e registra pendencia operacional.

## Sem Furos de Integracao

Para evitar furos, cada integracao deve ser tratada como adapter:

- WhatsApp nao cria regra de negocio.
- Google Calendar nao decide prioridade comercial.
- n8n nao define status oficial do lead.
- IA so executa acoes permitidas por regra de negocio e seguranca.

O SystemOps Core decide e registra o estado oficial.
