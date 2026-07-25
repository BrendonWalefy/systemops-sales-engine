# Relatório de validação por replay real

Data da execução: 24–25/07/2026  
Branch isolada: `chore/conversation-engine-validation`  
Banco: branch Neon descartável, nunca produção  
Corpora: exportados, sanitizados, revisados, aprovados e assinados fora do Git

## Conclusão executiva

O replay fechado confirmou que a maior parte da infraestrutura conversacional é
isolada por clínica e repetível, mas encontrou um defeito real na resolução de
tratamentos da Ximendes:

- três tratamentos possuíam cópias idênticas do mesmo pipeline;
- duas variantes compartilhavam dez aliases genéricos;
- o texto explícito do lead apontava para um tratamento, mas o
  `identifiedTreatment` probabilístico da LLM podia selecionar outro registro;
- a escolha variável fazia o mesmo cenário iniciar o pipeline em duas execuções
  e ficar sem pipeline em outra.

O runtime foi corrigido para dar precedência à evidência explícita da mensagem
atual. O princípio aplicado é o guardrail canônico:

> A LLM entende e verbaliza. O sistema decide.

O cenário que reproduzia a falha passou de 66,7% para 100% de concordância de
caminho em três repetições. A auditoria de configuração também passou a emitir
P1 para pipelines clonados e aliases capazes de iniciar pipelines de donos
diferentes.

Nenhuma configuração ou dado de produção foi alterado.

## Como o replay funciona

Cada cenário atravessa o caminho de produção dentro do sandbox:

1. payload Z-API;
2. persistência em `inbound_events`;
3. fila `message.process`;
4. `ConversationOrchestrator`;
5. máquina de estado e pipeline;
6. outbox e fila `message.send`;
7. sender capturado ou efeito suprimido por shadow mode;
8. limpeza dos dados criados pela execução.

O runner:

- valida fingerprint da clínica e do playbook;
- recusa banco que não seja o sandbox explícito;
- recusa fila preexistente;
- não consulta ou escreve no Google Calendar real;
- não envia WhatsApp real;
- registra `DecisionTrace` por turno;
- compara intenção, estado, fonte da decisão e forma de entrega entre repetições;
- persiste relatório, resultado estrutural e transcrição privada fora do Git.

## Resultado por clínica

| Clínica | Execução representativa | Checks | Caminho | Efeito externo | Resultado |
|---|---:|---:|---:|---|---|
| Ximendes, antes da correção | 1 cenário × 3 | 100% | 66,7% | capturado | divergência real |
| Ximendes, depois da correção | 1 cenário × 3 | 15/15 | 100% | 3/3 capturados | sem achados |
| NC Beauty | 1 cenário longo × 2 | 100% | 100% | 14 suprimidos | sem achados |
| NC Beauty, regressão | 1 cenário × 2 | 10/10 | 100% | 2 suprimidos | sem achados |
| Maycon Bordados | 2 cenários × 2 | 20/20 | 100% | 10 suprimidos | sem achados |
| Maycon, regressão | 1 cenário × 2 | 10/10 | 100% | 2 suprimidos | sem achados |
| Clínica Vitalli | 2 cenários × 2 | 12/20 | 100% | nenhum | bloqueada por política |

### Ximendes

Achado confirmado e corrigido no runtime:

- código anterior: a LLM podia substituir uma menção explícita entre variantes
  que possuíam pipeline;
- código atual: menção direta ou menção textual de pipeline vence o
  `identifiedTreatment` probabilístico;
- teste unitário cobre as três respostas possíveis do classificador sobre a
  mesma mensagem;
- replay pós-correção: 100% operacional, 100% de intenção, 100% de caminho e
  nenhum achado automático.

Dívida de configuração ainda existente:

- três cópias byte a byte do mesmo `pipelineSteps`;
- dez aliases genéricos duplicados entre variantes;
- a correção de código remove a não-determinação, mas o dado deve ser
  consolidado em um tratamento canônico;
- variantes devem apontar para ele por `pipelineSourceTreatmentId` e manter
  somente aliases específicos.

Essa alteração de dados não foi aplicada automaticamente porque exige aprovação
editorial e plano de rollback.

### NC Beauty

O cenário longo passou depois de duas correções no próprio harness:

- shadow mode agora é um efeito observável `suppressed`, não ausência de envio;
- pausa intencional da IA é um terminal explicado, não trace incompleto;
- o relógio das filas acompanha o relógio virtual do cenário.

Resultado estável:

- 100% dos checks;
- 100% de concordância de intenção;
- 100% de concordância de caminho;
- nenhum envio externo;
- nenhum achado automático.

### Maycon Bordados

O replay provou que o target não está limitado a clínicas:

- mesmo webhook, filas, orquestrador, outbox e sender;
- 100% dos checks;
- 100% de concordância de intenção e caminho;
- efeitos corretamente suprimidos por shadow mode;
- nenhum achado automático.

### Clínica Vitalli

O motor não chegou à conversa porque a fotografia atual da clínica contém:

- `operationalStatus = paused`;
- `autoReplyEnabled = false`;
- shadow mode desativado.

Os oito turnos executados terminaram em
`automation_reply_disabled`, com 100% de repetibilidade. Portanto:

- não é evidência de falha conversacional;
- é um bloqueio operacional real e agora explicitamente diagnosticado;
- para avaliar qualidade de resposta, a clínica precisa de uma fotografia
  aprovada em shadow/test ou da ativação deliberada da automação;
- o runner não altera essa política para fazer o teste “passar”.

## Confronto com o handoff V1/V2

O replay reforçou os pontos do handoff que permanecem válidos:

- decisões de negócio precisam ser determinísticas;
- prompts, playbooks e código não podem disputar o mesmo fato;
- clínica, playbook, tratamento e pipeline precisam ter donos explícitos;
- observabilidade deve mostrar de onde veio a decisão final;
- mudanças devem ser validadas por clínica e por cenário real, não apenas por
  testes unitários genéricos.

Também refinou pontos que eram amplos demais:

- não apareceu mistura de dados entre clínicas nos cenários executados;
- shadow mode e automação pausada não são bugs de silêncio quando observados
  corretamente;
- a divergência encontrada não veio de sobreposição de prompt, mas da combinação
  de catálogo duplicado com uma decisão probabilística tendo precedência sobre
  evidência explícita;
- a ferramenta precisa distinguir bug do produto, dívida de configuração e
  limitação do próprio harness.

## Estado da ferramenta reutilizável

Pronto para uso recorrente:

- exportação sanitizada por allowlist;
- revisão humana obrigatória;
- assinatura e verificação do dataset;
- seleção distribuída ou por ID exato;
- limite de custo por número de turnos;
- repetição do mesmo cenário;
- captura de WhatsApp e agenda;
- Decision Trace;
- detecção de silêncio explicado;
- detecção de divergência de caminho;
- relatório Markdown, JSON e transcrição privada;
- execução contra branch descartável do banco.

Antes de go-live ou alteração relevante de uma clínica:

1. gerar corpus atualizado;
2. revisar e assinar;
3. criar branch descartável do banco;
4. executar amostra distribuída;
5. repetir cenários críticos por ID;
6. ler achados e conversas;
7. corrigir código/configuração no lugar canônico;
8. repetir o mesmo cenário antes/depois;
9. executar `npm run verify`;
10. promover somente com QA manual e CI verdes.

## Pendências que não devem ser escondidas

1. Consolidar os três pipelines de lentes da Ximendes após aprovação do diff de
   dados e rollback.
2. Criar uma fotografia de teste aprovada para Vitalli se a intenção for medir
   a qualidade conversacional enquanto produção permanece pausada.
3. Expandir a amostra progressivamente; os relatórios atuais provam o mecanismo
   e os cenários executados, não todos os 197 cenários do corpus.
4. Avaliação humana de tom, qualidade comercial e correção da resposta continua
   necessária. A confiança automática mede integridade e repetibilidade.
