# Contrato de fidelidade do replay conversacional

Este contrato define quando um resultado pode ser chamado de **replay fiel**.
Ele existe para impedir que um simulador simplificado fique verde enquanto o
fluxo usado pelas clínicas continua quebrado.

## Definição

Um replay fiel usa o mesmo código de produção entre a entrada recebida e a
decisão de entrega:

```text
payload do provedor
  -> webhook
  -> inbound_events
  -> job message.process
  -> ConversationOrchestrator
  -> ConversationStateMachine / regras determinísticas
  -> outbound_messages
  -> job message.send
  -> adapter de captura
```

O replay pode substituir apenas fronteiras que provocariam efeitos fora do
sandbox: WhatsApp, Google Calendar, armazenamento de mídia e relógio. A
substituição acontece por ports/adapters; não pode adicionar condições de
negócio especiais ao orquestrador.

## Requisitos obrigatórios

Cada execução deve:

1. usar um banco isolado, nunca o banco ativo de uma clínica;
2. carregar uma cópia versionada da configuração, playbook, tratamentos,
   profissionais, módulos e agenda necessários à clínica;
3. validar o fingerprint dessa configuração antes do primeiro turno;
4. aceitar somente dataset sanitizado `replay-dataset.v2`, aprovado por revisão
   humana e com assinatura Ed25519 válida;
5. reconstruir o payload real do canal para texto e cada tipo de mídia;
6. preservar ordem, rajadas, pausas e concorrência descritas pelo cenário;
7. persistir e drenar as mesmas filas usadas em produção;
8. capturar todas as tentativas de WhatsApp e calendário sem chamar provedores;
9. registrar `DecisionTrace`, transcript, alterações de estado e efeitos
   capturados sob o mesmo `runId`/`turnId`;
10. falhar quando houver job pendente, resposta ausente, efeito externo real,
    diferença de fingerprint ou trace incompleto.

Os modelos reais configurados para classificação e composição devem ser usados
no modo de validação conversacional. Como a saída de LLM não é determinística,
cada cenário precisa de repetições e o relatório deve separar:

- invariantes determinísticas, que têm de passar em 100% das execuções;
- qualidade conversacional, apresentada como distribuição;
- taxa de reprodução de cada bug;
- erro do provedor/modelo, que não pode virar resultado verde.

## Modos

- `historical_turn`: restaura o prefixo histórico antes de cada mensagem do
  lead e compara a nova decisão daquele turno. É o modo mais próximo de uma
  reprodução de incidente.
- `closed_loop`: envia somente as mensagens do lead em sequência e deixa a IA
  atual construir suas próprias respostas e estado.
- `counterfactual`: parte de um cenário aprovado e altera uma dimensão
  declarada, sem fingir que a conversa resultante aconteceu em produção.
- `concurrency`: reproduz rajadas e disputas com os offsets originais para
  validar debounce, idempotência e ordenação.

Respostas históricas do agente nunca são reenviadas como se fossem mensagens
novas no `closed_loop`; elas são evidência de comparação.

## O que não é replay fiel

Não pode receber o selo de fidelidade:

- chamar `IntentClassifier` e `ResponseComposer` diretamente;
- usar `mapToAction` ou outro espelho do `ConversationOrchestrator`;
- pular webhook, banco, fila, estado, outbox ou sender;
- usar uma clínica QA genérica no lugar do snapshot da clínica avaliada;
- trocar agenda por slots inventados sem declarar o teste como unitário;
- desligar o WhatsApp com retorno silencioso sem capturar o que seria enviado;
- editar `status: approved` ou data de revisão manualmente no JSON;
- considerar confiança do classificador como nota de qualidade da conversa.

Os harnesses que fazem isso podem continuar como testes unitários ou de
diagnóstico, com nome e documentação explícitos, enquanto trouxerem valor. Eles
não podem bloquear ou aprovar promoção entre ambientes.

## Evidência mínima por execução

Um resultado só é publicável quando contém:

- commit do SystemOps e versão do dataset;
- fingerprint esperado e observado da clínica;
- modo, repetição, seed quando aplicável e versão dos modelos;
- transcript sanitizado;
- trace ordenado por turno;
- estados antes/depois;
- efeitos capturados de canal e calendário;
- checks determinísticos;
- achados com severidade, evidência e provável proprietário;
- estado terminal inequívoco: `passed`, `failed` ou `infrastructure_error`.

## Gate para limpeza

Um teste, script ou workflow antigo só pode ser removido quando a matriz de
substituição mostrar:

1. qual risco ele cobria;
2. qual teste novo cobre o mesmo risco;
3. evidência de que o teste novo falha quando o comportamento é quebrado;
4. execução verde no ambiente suportado;
5. ausência de referência ativa em CI, documentação ou operação.

Arquivos com dados reais, IDs fixos de clínica, prompts duplicados ou
orquestradores espelhados têm prioridade de remoção depois desse gate.
