# ADR — Expansão das capacidades de negócio no runtime V2

Date: 2026-08-31
Status: accepted for planning

## Contexto

O runtime produtivo é V2-only. A V1 permanece no repositório somente como referência histórica e
como fonte de casos de teste; ela não pode ser chamada, selecionada ou usada como fallback.

A V1 acumulou comportamentos úteis do negócio — recepção, objeções, jornada de tratamento,
mídia, agenda completa, sinal, urgência e automações — dentro de um orquestrador grande. A V2 já
resolve autoridade, separação entre entendimento, decisão, efeito e linguagem, mas ainda não
possui paridade funcional em todos esses domínios.

Parte relevante da configuração já tem uma interface no produto. Criar uma segunda configuração
"da V2" duplicaria fontes de verdade e faria a UI divergir da conversa.

## Decisão

Traremos os comportamentos úteis para a V2 como **capacidades verticais de negócio**. Cada
capacidade terá uma leitura tenant-scoped, uma decisão determinística, efeitos executados por um
serviço de aplicação existente e um `ActionResult` com provenance. O modelo continuará limitado a
duas responsabilidades:

1. transformar a conversa em entendimento estruturado;
2. verbalizar fatos e ações já autorizados.

Não haverá cópia de condicionais da V1 para `V2LiveConversationHandler`, nem um novo motor genérico
de regras, nem configuração duplicada. A V1 serve para descobrir casos e construir fixtures; o
código produtivo novo respeita as fronteiras da V2.

## Desenho simples

```text
UI existente
  Playbook | Tratamentos | Pipeline | Biblioteca | Agenda
  Profissionais | Inbox | Campanhas | Configurações financeiras
                         |
                         v
              fontes de verdade no PostgreSQL
                         |
WhatsApp -> inbox/authority/job -> snapshot tenant-scoped do turno
                         |
                         v
               Understanding V2 (estrutura)
                         |
                         v
                 coordenador de capabilities
       +-------------+-------------+-------------+
       |             |             |             |
   conhecimento   comercial    jornada/mídia   agenda
       |          e objeções       e sinal      completa
       +-------------+-------------+-------------+
                         |          clínico/handoff
                         v
             decisão determinística + serviço existente
                         |
                         v
              ActionResult + provenance + receipt
                         |
                         v
      AuthorizedResponsePlan -> verbalizador -> validator/fallback
                         |
                         v
          outbox com authority -> sender preflight -> WhatsApp

Decision Trace: correlaciona todas as etapas pelo turnId, sem conteúdo sensível.
```

## Responsabilidade de cada peça

| Peça | Responsabilidade | Não pode fazer |
| --- | --- | --- |
| UI | Editar a configuração canônica e permitir operação humana | Decidir o fluxo de uma mensagem em runtime |
| Turn snapshot | Resolver uma vez tenant, conversa, estado e configuração ativa | Misturar dados de tenants ou buscar config global |
| Understanding | Classificar pedido, entidades e sinais conversacionais em schema fechado | Escolher efeito, preço, horário ou texto final |
| Capability | Verificar fatos e produzir uma `Decision` explícita | Enviar mensagem ou inventar fato ausente |
| Serviço de aplicação | Executar um efeito idempotente e tenant-scoped | Interpretar texto livre ou compor resposta |
| ActionResult | Registrar resultado, evidência e provenance do efeito | Carregar segredo, prompt ou conteúdo bruto no trace |
| Response plan | Definir exatamente o que pode ser dito | Criar fatos ou executar efeito |
| Verbalizador | Dar naturalidade ao plano autorizado | Alterar decisão ou adicionar promessa, preço ou agenda |
| Validator/fallback | Bloquear saída fora do contrato e produzir saída segura | Repetir chamada ao modelo em loop |
| Outbox/sender | Persistir e entregar exatamente uma resposta autorizada | Recalcular conversa ou ignorar authority/safety |

## Famílias de capacidades

### 1. Conhecimento e recepção

- saudação, reconhecimento e despedida;
- endereço, horários, localização, estacionamento, redes e informações institucionais;
- explicação e comparação de tratamentos;
- perguntas frequentes e limites de resposta.

Fontes: `organizations`, `playbook_versions` e `treatments`.
UI proprietária: perfil, Playbook/Geral, Playbook/Conhecimento e Tratamentos.

### 2. Comercial e objeções

- preço autorizado, campanhas vigentes, condições e parcelamento;
- dúvidas de quantidade/escopo e confirmação antes de calcular;
- sensibilidade a preço e objeções mapeadas;
- encaminhamento quando a política não autoriza uma afirmação.

Fontes: `playbook_versions.commercialPolicy`, `price_campaigns`, `treatments` e configuração
financeira da organização. O sistema escolhe a informação permitida; o modelo apenas verbaliza.
UI proprietária: Playbook/Financeiro, Tratamentos e Campanhas.

### 3. Jornada de tratamento, mídia e sinal

- execução ordenada de `pipelineSteps` de conteúdo, pergunta, foto, vídeo e oferta de agenda;
- recebimento de mídia e continuação segura da jornada;
- envio apenas de mídia cadastrada na biblioteca;
- reserva provisória, instruções de sinal, recebimento de comprovante, revisão humana e expiração.

Fontes: `treatments.pipelineSteps`, biblioteca de mídia, estado da conversa, configuração de sinal
e reservas. A IA não valida comprovante e não escolhe mídia por URL livre.
UI proprietária: Pipeline, Biblioteca, Tratamentos, Inbox/DepositBanner e configurações financeiras.

### 4. Ciclo completo da agenda

- buscar, oferecer, rejeitar e refazer ofertas de horário;
- expiração ou tomada concorrente de slot com nova oferta;
- criar, confirmar, listar, cancelar e reagendar compromissos;
- redirecionar tratamento que exige avaliação;
- selecionar profissional e calendário dentro da configuração do tenant.

Fontes e efeitos: `BookingService`, `SlotReservationService`, appointments, calendar blocks,
profissionais e gateways tenant-scoped. Nenhuma capability escreve diretamente no Google Calendar.
UI proprietária: Agenda, Profissionais e Playbook/Agenda.

### 5. Operação clínica e handoff

- urgência clínica sem diagnóstico;
- problema em trabalho existente;
- chegada e atraso do paciente;
- pedido explícito de humano, ambiguidade insegura ou caso não suportado;
- takeover e pausa de IA já controlados pelo Inbox.

O resultado é uma classificação operacional fechada, notificação/handoff idempotente e uma
resposta segura. Não haverá recomendação clínica gerada pelo modelo.

### 6. Automações do ciclo de relacionamento

- confirmação e lembrete de consulta;
- follow-up, recuperação e pós-atendimento;
- continuação após vídeo;
- campanhas e opt-out.

Essas automações não fingem ser um novo inbound. Elas reutilizam `ActionResult`, plano autorizado,
outbox, authorization kind e sender preflight da V2, mantendo seus próprios gatilhos e dedupe.
UI proprietária: Campanhas, Agenda, Inbox e configurações de automação.

## Contrato de rastreabilidade

Todo turno ou automação deve ser reconstruível por referências opacas, sem telefone ou conteúdo:

1. `ingress.received`: evento e stream registrados;
2. claim: job, geração, inbound e token ligados uma única vez;
3. `v2.understanding`: versão, request, modelo, duração ou código fechado de falha;
4. `v2.decision`: capabilities, tipos de decisão e efeitos pretendidos;
5. `v2.action_result`: outcomes, efeitos concluídos/falhos e receipts;
6. `response.plan_built`: fatos/opções/evidências autorizados;
7. `response.validated` e, quando necessário, `response.fallback_applied`;
8. `v2.outbox`: mensagem/job criados ou deduplicados;
9. sender preflight e `delivery.sent` ou estado terminal com razão fechada.

O `turnId` liga a cadeia. O Decision Trace continua armazenando somente metadados allowlisted por
30 dias. Uma saída bruta rejeitada pelo contrato permanece no cofre criptografado já existente,
com revelação owner auditada e retenção curta; ela nunca é copiada para o trace.

Cada capability deve acrescentar ao trace somente identificadores fechados: `capabilityId`,
`decisionKind`, `outcomeType`, `effectKind`, status e contagens. O receipt do efeito prova qual
serviço respondeu sem expor o dado de negócio.

A rota tenant-scoped de Decision Trace já existente será exposta como diagnóstico read-only dentro
da conversa no Inbox. A visão mostrará a linha do tempo, o primeiro estágio ausente/falho, códigos
fechados, latência e contagens. Somente owner poderá ver metadados das evidências de rejeição e a
revelação do conteúdo continuará no fluxo privilegiado e auditado já existente. Assim, a
rastreabilidade não depende de acesso direto ao banco nem cria uma segunda tela de conversa.

## Contratos de segurança e qualidade

- runtime produtivo V2-only e `conversation_authority.version >= 2`;
- tenant pausado, demo, prospect, desabilitado ou sem authority v2 permanece fail-closed;
- kill switch global, consentimento, opt-out, takeover, shadow/observe e safety gates continuam
  cumulativos no sender;
- no máximo uma chamada de Understanding e uma de verbalização por turno;
- nenhum retry inline de modelo;
- efeito confirmado não é recomposto em retry;
- toda escrita tem chave de idempotência e escopo de tenant;
- resposta contém somente fatos com provenance; ausência ou ambiguidade produz esclarecimento ou
  handoff, nunca adivinhação;
- exatamente uma resposta segura ou um estado terminal explícito;
- nenhuma capability introduz polling, heartbeat ou worker contínuo;
- nenhum deploy ativa tenants ou altera suas configurações.

## Estratégia de entrega rápida

O trabalho será dividido em fatias verticais pequenas. Uma fatia entrega um comportamento de
negócio completo: request, capability, adapter, efeito, resposta, trace e testes. Não haverá um PR
único de “paridade total”.

Meta operacional para uma fatia que apenas envolve serviços e UI já existentes: 2–4 horas de
trabalho ativo, excluindo espera de CI/deploy. Se a fatia exigir schema, uma nova fonte de verdade,
mais de um domínio ou ultrapassar quatro horas sem ficar verde, ela deve ser dividida antes de
continuar. Jornada/mídia/sinal e agenda serão naturalmente compostas por mais de uma fatia.

O tempo de espera será medido separadamente em investigação, RED, implementação, gates locais,
CI e deploy. Isso evita confundir execução lenta de infraestrutura com complexidade do produto.

## Alternativas rejeitadas

### Copiar o orquestrador V1

Parece rápido no primeiro comportamento, mas recupera o monólito, mistura linguagem e efeito,
impede provenance por decisão e aumenta o risco de efeitos duplicados.

### Chamar V1 quando a V2 não souber

Viola o runtime definitivo, cria dois donos da conversa e torna authority, retry e investigação
dependentes de qual engine respondeu.

### Criar uma DSL genérica para todas as jornadas

Reduz arquivos, mas esconde regras de agenda, comercial e sinal no mesmo interpretador. Os
contratos verticais são mais simples de testar e podem reutilizar diretamente os serviços atuais.

### Criar telas e tabelas “V2” paralelas

Duplicaria playbook, tratamentos, pipeline, agenda e campanhas. A UI existente continuará sendo a
porta de edição das fontes canônicas; somente dado de negócio realmente inexistente pode justificar
uma evolução de schema e UI em PR próprio.

## Consequências

- A paridade chega em incrementos utilizáveis e reversíveis.
- A conversa pode ser investigada estágio a estágio, inclusive quando não houve outbound.
- A naturalidade da V1 é recuperada pelo verbalizador híbrido, sem devolver ao modelo autoridade
  sobre fatos e efeitos.
- Alguns comportamentos permanecerão em handoff até a sua fatia ser entregue; não haverá fallback
  silencioso.
- A V1 só poderá ser removida depois que a matriz de paridade estiver completa, os casos históricos
  estiverem representados em fixtures V2 e uma busca provar que nenhum root produtivo a alcança.
