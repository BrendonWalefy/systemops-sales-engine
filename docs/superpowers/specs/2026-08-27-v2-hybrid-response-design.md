# Resposta híbrida contextual da V2

**Data:** 2026-08-27

**Status:** direção aprovada pelo owner para implementação e produção

**Escopo:** melhorar a naturalidade e a pertinência da resposta V2 sem devolver decisões à IA, sem reativar V1 e sem adicionar tentativas de modelo

## Decisão

A V2 passa a verbalizar com duas fontes de entrada separadas:

1. o plano de resposta já autorizado, que continua sendo a única fonte de fatos, efeitos e próximos passos;
2. um briefing conversacional pequeno, imutável e sanitizado, derivado do Understanding aceito, usado somente para relevância, continuidade e tom.

O fluxo produtivo permanece:

```text
mensagem e histórico recente
  -> Understanding estruturado (uma chamada)
  -> capabilities e decisões determinísticas
  -> efeitos e resultados reais
  -> AuthorizedResponsePlan
  -> briefing conversacional sanitizado + statements autorizados
  -> verbalização contextual (no máximo uma chamada)
  -> validação determinística
  -> texto do modelo aceito ou renderer determinístico do mesmo plano
```

Esse é o híbrido: a IA entende e escolhe palavras; o sistema decide, executa e autoriza. A propriedade útil da V1 recuperada é a resposta considerar o sentido e o movimento do diálogo. A taxonomia, o orquestrador e a autoridade da V1 não entram no runtime.

## Motivo

O verbalizador atual recebe statements, valores permitidos, estilo e speaker, mas não recebe o Understanding aceito. Ele sabe o que precisa dizer, porém não sabe se o lead abriu um assunto, respondeu a uma pergunta pendente, repetiu algo, está sensível a preço ou manifestou sentimento negativo. Isso favorece prosa correta, mas genérica.

Dar ao verbalizador a mensagem bruta e o histórico completo aumentaria a superfície de prompt injection e permitiria que conteúdo não autorizado parecesse fato. Fazer Understanding, decisão e resposta em uma única geração impediria que a resposta dependesse de disponibilidade, reserva, booking e demais efeitos reais. As duas alternativas foram rejeitadas.

## Responsabilidades

| Peça | Responsabilidade | Não pode fazer |
| --- | --- | --- |
| Understanding model | interpretar pedido, movimento de diálogo, entidades, sinais e safety | responder, decidir ou executar |
| `buildResponseConversationBrief` | reduzir o Understanding aceito a vocabulário fechado e campos limitados | copiar mensagem, histórico, objeção livre ou dados pessoais |
| Capabilities | decidir e executar usando estado e política | escolher prosa final |
| `AuthorizedResponsePlan` | declarar fatos, valores, opções, efeitos e próximos passos permitidos | incorporar texto bruto do lead/modelo |
| Verbalizer | transformar statements autorizados em português natural considerando o briefing | criar fato, valor, promessa, efeito ou pergunta não autorizada |
| Validator | aceitar ou recusar a prosa antes da outbox | reparar por nova chamada ou reinterpretar intenção |
| Renderer determinístico | garantir uma resposta segura quando o modelo falha ou é recusado | recomputar efeito ou tentar outro modelo |

## Contrato do briefing

O conversation-core define um contrato genérico:

```ts
type ResponseConversationBrief = Readonly<{
  request: string | null;
  dialogueMove: "new_topic" | "answers_pending" | "acknowledges" | "repeats" | "closes";
  sentiment: "negative" | "neutral" | "positive" | null;
  purchaseIntent: "low" | "medium" | "high" | null;
  priceSensitivity: "low" | "medium" | "high" | null;
  hasObjection: boolean;
  ambiguityKind: string | null;
}>;
```

O builder dental aceita somente um `Understanding<DentalRequest>` que já atravessou validação estrutural e semântica. Ele não copia `leadMessage`, `history`, `entities.service`, candidatos, texto livre de `signals.objection` nem qualquer chave desconhecida. `request` e `ambiguityKind` são revalidados contra vocabulários permitidos; valores desconhecidos falham fechados para `null`.

O assunto e os valores que podem aparecer na resposta continuam vindo exclusivamente de `AuthorizedStatement` e `AuthorizedSurface`.

## Prompt e validação

O payload do verbalizador ganha somente `conversationBrief`. O prompt o classifica explicitamente como contexto de maneira:

- `answers_pending`: responder como continuidade, sem reiniciar a conversa;
- `acknowledges` ou `closes`: evitar reabrir assunto ou acrescentar proposta não autorizada;
- sentimento negativo ou objeção: reconhecer com sobriedade sem inventar solução;
- sensibilidade a preço: ser direto e não criar desconto ou condição;
- ambiguidade: formular somente a pergunta já autorizada.

Statements e surface continuam tendo precedência absoluta. A validação atual de valores inteiros, números, dinheiro, links, perguntas, promessas e tamanho permanece. Rejeição não gera repair por modelo: registra evidência e envia o renderer determinístico do mesmo plano.

## Chamadas, retry e custo

- Understanding: no máximo uma chamada por execução autorizada do turno.
- Verbalização: no máximo uma chamada depois de existir resposta segura.
- Nenhum loop de modelo, judge, repair por IA ou troca de provider é introduzido.
- Turnos suprimidos não verbalizam.
- Falha/rejeição da verbalização não recompõe decisão nem efeito.
- O payload adicional deve ficar abaixo de 320 bytes no caso máximo do contrato.
- A média e o p95 de chamadas ao modelo não podem superar o baseline V2 atual.
- Tokens médios não podem crescer mais que 10%; p95 não mais que 15%, conforme o gate existente.
- Nenhuma query, round trip, lock, job ou outbound adicional é permitido.

## Observabilidade

`response.validated` passa a registrar metadados fechados:

- `responseStrategy=hybrid_contextual_v1` quando o briefing foi fornecido;
- `responseStrategy=deterministic_only` quando não houve verbalizador;
- `understandingCalls=1` e `verbalizationCalls=0|1` conforme o caminho executado.

O trace não recebe conteúdo, request livre, objeção, subject, mensagem ou histórico. A evidência criptografada de rejeição permanece inalterada.

## Segurança e isolamento

- V2-only, authority version 2, kill switch, tenant live permit, takeover, consentimento, opt-out, shadow/observe e sender preflight permanecem inalterados.
- Nenhuma configuração ou activation é criada.
- Nenhuma migration é necessária.
- Nenhum tenant é habilitado pelo deploy.
- Dedupe e exactly-once do stream/outbox/sender não mudam.
- O deploy não executa mensagem sintética nem escreve dados de conversa.

## Aceitação

1. O verbalizador recebe o briefing fechado e não recebe mensagem/histórico/raw Understanding.
2. O briefing é derivado uma vez do Understanding aceito e acompanha o mesmo turno.
3. Respostas aceitas continuam sujeitas ao mesmo validator e à mesma authority.
4. Saída inválida gera exatamente uma resposta determinística, sem nova chamada.
5. Testes provam continuidade, preço, sentimento, objeção, ambiguidade e fechamento.
6. Um turno entregue faz no máximo duas chamadas totais e uma chamada por estágio.
7. Não há alterações de banco, jobs, outbox, sender ou tenant.
8. `npm run verify`, build limpo, CI, preview e produção ficam verdes.

## Rollback

O commit é reversível sem migration ou backfill. Em regressão real, o kill switch/handoff continua sendo o primeiro freio; o código pode ser revertido para o verbalizador sem briefing. Rollback nunca seleciona V1.
