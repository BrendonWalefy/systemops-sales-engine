# ADR — Conversação V2 orientada pelo risco

Date: 2026-09-01
Status: accepted

## Contexto

O runtime produtivo é V2-only. A V1 permanece somente como referência histórica e fonte de casos
sanitizados; nunca pode ser selecionada ou usada como fallback.

A V2 já possui as fronteiras corretas: `Understanding`, `Decision`, `ActionResult`, plano de
resposta autorizado, outbox durável e sender com preflight. Criar um novo contrato, roteador ou
classe para cada intenção duplicaria essa arquitetura e aumentaria a rigidez da conversa.

O objetivo é recuperar a cobertura e a naturalidade úteis da V1 sem recuperar seu orquestrador
monolítico e sem transformar a V2 em um conjunto excessivo de guardas.

## Decisão

Manteremos um único runtime e o pipeline atual. Os comportamentos serão organizados em cinco
módulos de negócio e três caminhos proporcionais ao risco:

1. caminho conversacional de leitura;
2. caminho transacional com efeito;
3. automações iniciadas pelo sistema.

Os nomes conceituais abaixo correspondem aos contratos que já existem; não serão criados aliases
ou wrappers apenas para renomeá-los.

| Conceito | Contrato existente |
| --- | --- |
| Entendimento do turno | `Understanding<DentalRequest>` |
| Decisão do domínio | `Decision` |
| Recibo do resultado | `ActionResult<DentalOutcomeSchema>` |
| Envelope autorizado | `V2AuthorizedResponsePlan` + resposta validada |

## Arquitetura

```text
WhatsApp
   |
   v
inbox + stream authority v2 + job
   |
   v
LiveTurnContext + snapshot (carregados uma vez)
   |
   v
Understanding estruturado (uma chamada)
   |
   +----------------------+-----------------------+
   |                      |                       |
   v                      v                       v
LEITURA                TRANSAÇÃO               AUTOMAÇÃO
conhecimento           agenda/sinal            lembrete/follow-up
comercial/objeção      jornada/opt-out          campanha/recuperação
   |                      |                       |
   |                 serviço canônico             | sem Understanding
   |                 + idempotência                |
   +----------------------+-----------------------+
                          |
                          v
        ActionResult -> plano autorizado -> verbalização
                          |
                          v
              outbox -> sender preflight -> WhatsApp
```

## Cinco módulos, não uma classe por intenção

| Módulo | Responsabilidade |
| --- | --- |
| Knowledge (`knowledge-capability.ts`) | Recepção, informações institucionais, tratamentos e FAQ |
| Commercial | Preços, campanhas, pagamentos, quantidade e objeções |
| Scheduling | Horários, profissionais, criar, listar, cancelar e reagendar |
| Journey | Pipeline, mídia, reserva, sinal e comprovante |
| Operations | Handoff, urgência, chegada, opt-out e automações |

Um módulo pode oferecer várias `Capability` factories no mesmo arquivo quando compartilham uma
fonte de verdade e uma política. Uma capability representa uma autoridade de negócio, não uma
frase que o cliente pode escrever.

## Caminho conversacional de leitura

Usado quando o turno não altera estado externo: saudação, conhecimento, explicação, comparação,
preço autorizado, condição comercial e objeção.

- O Understanding escolhe um pedido e entidades em schema fechado.
- O módulo resolve fatos exclusivamente da organização reivindicada.
- A `Decision` do tipo `answer`, `ask`, `offer` ou `escalate` contém fatos e evidências.
- O `ActionResult` transforma esses fatos no plano autorizado.
- O verbalizador produz a resposta natural em uma única chamada adicional somente quando existe
  conteúdo a verbalizar.

Não haverá validação semântica duplicada da prosa inteira. O validator protege somente superfícies
de risco: dinheiro, números, datas/horários, links, mídia, promessas, fatos sem evidence ref,
quantidade de perguntas e tamanho. Demais qualidade conversacional é governada por evals.

## Caminho transacional

Usado quando existe efeito: agenda, reserva, estado da jornada, sinal, consentimento ou handoff.

- O modelo apenas propõe pedido e parâmetros.
- A capability verifica a leitura atual e produz uma `Decision.execute` tipada.
- O serviço canônico executa com tenant scope e chave idempotente.
- O `ActionResult` registra o que realmente ocorreu, inclusive falha.
- A resposta comunica o receipt; retry nunca recompõe um efeito confirmado.

Agenda continua em `BookingService`/casos de uso de calendário. Reserva continua em
`SlotReservationService`. Comprovante continua em revisão humana. Capabilities não escrevem
diretamente em PostgreSQL, Google Calendar ou provider.

## Automações

Lembretes, follow-ups, recuperação, pós-atendimento e campanhas não executam Understanding sem um
novo inbound. Seus produtores determinísticos criam um `ActionResult`, usam a mesma fronteira de
resposta autorizada e preservam authorization kind, opt-out, horário seguro, dedupe e sender
preflight.

## Guardas mínimas obrigatórias

Cada regra deve existir em um único dono. Permanecem somente guardas que protegem um risco real:

1. tenant, stream, claim e `conversation_authority.version >= 2`;
2. schema estruturado na saída do modelo;
3. invariantes do serviço antes de qualquer escrita;
4. grounding de dinheiro, agenda, link, mídia, promessa e demais fatos de alto risco;
5. idempotência, consentimento, takeover, kill switch e autorização no sender.

Defesa em profundidade permanece apenas nas duas fronteiras irreversíveis: criação da outbox e
entrega ao provider. Não serão adicionados guardas repetidos no handler, capability, composer e
sender para a mesma regra.

Um turno só pode entrar em automação live quando a organização exata está `active`, com
`auto_reply_enabled` e `live_automation_enabled`, sem shadow/observe, e possui
`conversation_authority.version >= 2`. Tenant pausado, desabilitado, demo, prospect ou sem
authority v2 permanece fail-closed: o deploy não altera nem ativa sua configuração.

No instante da entrega, o sender relê e exige cumulativamente: kill switch global aberto,
authority v2, tupla exata stream/generation/inbound/claim, status operacional ativo, auto-reply,
permissão live tenant-scoped, ausência de shadow/observe e takeover, consentimento/opt-out e safety
gates. A remoção de approval por build não remove nenhum desses controles. Falha ou leitura
inconclusiva bloqueia o outbound e nunca redireciona para V1.

Não haverá retry inline de modelo. Falha de Understanding encerra com código fechado e handoff ou
resposta segura conforme a política. Falha/rejeição da verbalização usa uma única resposta
determinística derivada do mesmo plano.

Os budgets duráveis existentes permanecem: até três claims para um novo `message.process` e até
dez para `message.send`. Retry reutiliza claim, dedupe, outbox e efeitos confirmados. Ao esgotar o
budget, o turno termina em uma resposta segura já autorizada ou `handoff_required`; entrega termina
em `sent`, `cancelled`, `dead` ou handoff explícito. Não há silêncio indefinido, loop nem
recomposição de efeito.

## Rollout e rollback

Cada ativação futura continua tenant-scoped, validada e feita por compare-and-set depois de drenar
workers/outbounds antigos. O corte nunca promove em massa tenants pausados ou inelegíveis. O
primeiro mecanismo de contenção é fechar o kill switch global e fazer handoff/correção forward; ele
nunca reativa V1. Depois de existir um release V2-only comprovadamente saudável, redeploy desse
release passa a ser uma opção adicional. O procedimento canônico permanece em
`docs/operations/v2-only-runtime-rollout.md`.

## Gates de desempenho

Cada fatia compara o resultado ao baseline congelado em `evals/v2-only/runtime-baseline.json` com
o comando canônico de medição. Os limites permanecem: latência p50/p95 até +10% e no máximo
+100 ms/+250 ms absolutos; chamadas de modelo sem aumento; tokens médios até +10% e p95 até +15%;
statements p95 até +10% e no máximo +2 round trips; lock hold p95 até +10% e +5 ms; cardinalidade
de evento/job/outbox/resposta sem aumento; atividade Neon ociosa sem novos wakes/SQL e compute-active
no máximo +5%. Uma capability de leitura que usa o snapshot já carregado deve acrescentar zero
query, zero lock e zero job.

## Fontes de verdade e UI

Não será criada configuração paralela para V2:

| UI existente | Fonte consumida pelos módulos |
| --- | --- |
| Perfil e Playbook/Geral | organização, localização, horários e identidade |
| Playbook/Conhecimento | FAQ e conteúdo editorial publicado |
| Tratamentos | catálogo, aliases, descrição, preços e requisitos |
| Playbook/Financeiro e Campanhas | política comercial e campanhas ativas |
| Pipeline e Biblioteca | passos e mídia autorizada |
| Agenda e Profissionais | disponibilidade, compromissos e calendários |
| Inbox | takeover, handoff e revisão de comprovante |

Um campo/tabela/tela nova só é permitido quando uma fatia provar que o dado de negócio não possui
dono canônico. Nesse caso a evolução recebe especificação e migration próprias; nunca nasce como
um segundo campo “da V2”.

## Rastreabilidade operacional

O trace técnico atual permanece detalhado. A visão do Inbox o resume em seis marcos:

1. recebida;
2. entendida;
3. decidida;
4. executada;
5. respondida;
6. entregue ou terminal.

O primeiro marco ausente ou falho localiza a fronteira do problema. Detalhes mostram apenas códigos
fechados, capability, outcome, serviço/efeito, latência, tokens, fallback e status de entrega. Não
mostram telefone, mensagem, prompt ou resposta. Saída bruta rejeitada continua no cofre
criptografado existente, com acesso owner auditado e retenção curta.

## Qualidade e excelência conversacional

Não prometemos eliminar matematicamente toda alucinação de texto. Garantimos que texto não pode
autorizar dinheiro, agenda, sinal, consentimento ou outro efeito. Para respostas de leitura:

- fatos dinâmicos vêm de dados tenant-scoped e carregam evidence refs;
- ausência de fato gera esclarecimento ou handoff, não invenção;
- prompt é curto, com estilo e objetivo declarados uma vez;
- uma suíte de casos reais mede correção factual, entendimento, avanço da jornada, naturalidade,
  latência, tokens e handoff desnecessário;
- restrições novas só entram quando um caso reproduzido demonstrar o risco.

## Limites de complexidade

- um monólito modular, um banco e um deploy;
- sem microsserviços, broker, multiagente, supervisor agent, DSL ou rule engine;
- sem event sourcing completo;
- sem nova chamada ao modelo para roteamento;
- no máximo uma chamada de Understanding e uma de verbalização por inbound;
- consultas limitadas e reutilização do contexto já carregado;
- nenhum polling, heartbeat ou worker contínuo novo;
- nenhuma ativação automática de tenant.

## Entrega incremental

Cada fatia entrega um comportamento útil ponta a ponta e deve caber, quando reutiliza serviços
existentes, em uma meta de 2–4 horas de trabalho ativo. Espera de CI/deploy é medida separadamente.
Se uma fatia ultrapassar o orçamento por misturar fontes de verdade ou domínios, ela é dividida;
não se adiciona abstração genérica para fazê-la “caber”.

A ordem é:

1. Knowledge institucional como primeira prova do caminho de leitura;
2. Commercial;
3. Scheduling lifecycle;
4. Journey/sinal/mídia;
5. Operations/automações;
6. painel de trace e corpus final de paridade.

## Alternativas rejeitadas

- **Agente único com acesso direto a tudo:** natural, porém mistura interpretação e autoridade.
- **Capability por intenção/frase:** rastreável, porém cria explosão de classes e validações.
- **Fallback para V1:** dois donos para o mesmo turno e investigação ambígua.
- **Plataforma genérica de workflows:** concorre com a UI e os serviços verticais já existentes.

## Consequências

- A arquitetura aproveita o que já existe e adiciona principalmente decisões e adapters finos.
- Respostas de baixo risco permanecem naturais; operações de alto risco permanecem determinísticas.
- O custo de estrutura fica concentrado nas fronteiras irreversíveis.
- Alguns pedidos continuarão em handoff até a fatia correspondente ficar pronta.
- A remoção futura da V1 depende de paridade comprovada por fixtures, não de chamadas em runtime.
