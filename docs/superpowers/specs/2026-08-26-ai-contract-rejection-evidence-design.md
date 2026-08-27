# Evidência rastreável de saídas de IA rejeitadas

**Data:** 2026-08-26

**Status:** desenho aprovado em conversa; especificação escrita aguardando revisão do owner

**Escopo:** saídas produzidas por modelos no runtime conversacional V2 que são rejeitadas por contratos determinísticos antes do envio

## 1. Decisão

O SystemOps passa a preservar evidência suficiente para explicar exatamente por que uma saída de IA foi rejeitada. O Decision Trace continua sanitizado e sem conteúdo; uma nova evidência tenant-scoped guarda metadados estruturados por 30 dias e, por no máximo 7 dias, a saída bruta rejeitada criptografada.

A captura cobre dois pontos do runtime V2:

1. o JSON de Understanding retornado pelo modelo e rejeitado no parse estrutural ou na validação semântica;
2. o texto produzido pelo verbalizador e rejeitado pelo contrato de resposta antes do fallback determinístico.

Saídas aceitas não são armazenadas nessa evidência. Prompt, histórico, mensagem do lead, telefone, nome, email, credenciais e payload do provider não são copiados para ela. Uma saída rejeitada pode repetir dados recebidos e, por isso, seu conteúdo bruto é sempre tratado como sensível.

## 2. Evidência do incidente que motivou a mudança

Em 2026-08-26, três turnos consecutivos do SystemOpsLab executaram com `automationMode=live`, authority V2 e envio autorizado. Um turno concluiu Understanding e resposta normalmente; dois falharam em `v2.understanding` e enviaram exatamente uma resposta segura com intenção `safe_failure`.

O trace dos dois turnos registrou:

- modelo `gpt-4o-mini`;
- duração aproximada de 3,1 s e 4,5 s;
- fase `understanding`;
- razão `understanding_failed`;
- nenhum efeito tentado ou concluído;
- código de erro `unknown`.

Webhook, stream, claim, outbox, sender e provider de WhatsApp funcionaram. Não houve duplicação ou erro de entrega. O conteúdo bruto retornado pelo modelo e a classe exata da rejeição não foram preservados, então o trace atual localiza a fronteira da falha, mas não prova o valor rejeitado.

Existe também uma divergência concreta no código atual: o JSON Schema enviado ao modelo permite `entities.service=null` para qualquer intenção, enquanto o parser adiciona uma regra que exige `service` em `price-of-service`, `service-availability` e `explain-service`. Uma saída pode, portanto, obedecer ao contrato apresentado ao modelo e ser recusada depois. A ausência da evidência bruta impede afirmar se essa divergência foi a exceção exata dos dois turnos.

## 3. Objetivos

1. Explicar uma rejeição por modelo, versão, estágio, regra, campo e valor bruto devolvido.
2. Diferenciar falha do provider, JSON inválido, contrato estrutural, regra semântica e contrato de resposta.
3. Manter conteúdo bruto fora de logs, Sentry, Vercel e Decision Trace.
4. Garantir isolamento por tenant e acesso exclusivo do Owner.
5. Expirar o conteúdo bruto em 7 dias e os metadados em 30 dias.
6. Não alterar a decisão, o fallback, a authority, a outbox ou a entrega quando a observabilidade falhar.
7. Eliminar a duplicidade oculta entre o formato apresentado ao modelo e o parser estrutural.

## 4. Fora de escopo

- armazenar toda resposta aceita da IA;
- armazenar prompts, histórico completo ou mensagem original do lead;
- enviar evidência bruta a ferramentas externas de log ou monitoramento;
- criar replay automaticamente com dados reais;
- alterar provider ou modelo de IA;
- usar a evidência como fonte de decisão de negócio;
- corrigir toda lacuna funcional descoberta pela evidência no mesmo PR;
- recuperar retroativamente saídas brutas que nunca foram persistidas.

## 5. Invariantes

1. **Somente rejeições:** uma saída aceita não cria `ai_contract_rejections`.
2. **Tenant exato:** cada evidência pertence ao mesmo `organization_id` e inbound do turno.
3. **Sem plaintext persistido:** conteúdo bruto nunca entra no banco sem criptografia.
4. **Sem plaintext em telemetria:** logs e Decision Trace recebem somente códigos fechados e contagens.
5. **Retenção separada:** ciphertext expira em 7 dias; metadados e auditoria expiram em 30 dias.
6. **Acesso Owner:** equipe de tenant, rotas clínicas, workers e APIs públicas não podem revelar o ciphertext.
7. **Acesso auditado:** nenhuma saída bruta é entregue ao Owner sem registrar o acesso.
8. **Falha de observabilidade é best-effort:** não substitui a resposta segura, não reabre o turno e não cria retry de negócio.
9. **Sem efeitos novos:** captura não cria mensagem, job de negócio, outbound, booking ou handoff.
10. **Idempotência:** repetir a mesma rejeição do mesmo turno não cria evidência duplicada.
11. **Limite de tamanho:** uma saída acima do limite não é truncada e apresentada como completa; mantém hash, tamanho e estado `oversized` sem ciphertext.
12. **Contrato explícito:** validação estrutural e validação semântica são estágios diferentes e rastreáveis.

## 6. Alternativas consideradas

### 6.1 Metadados e ciphertext em uma evidência separada — escolhida

O Decision Trace conserva sua promessa de não armazenar conteúdo. A evidência separada recebe retenção, criptografia, autorização e auditoria próprias. É a única alternativa que entrega diagnóstico exato sem ampliar a superfície de leitura de toda a telemetria.

### 6.2 Ciphertext dentro de `decision_traces` — rejeitada

Mistura retenções de 7 e 30 dias, torna toda consulta de trace sensível e acopla o endpoint clínico atual à autorização Owner. Também aumenta o risco de uma serialização futura devolver o campo indevidamente.

### 6.3 Somente paths e códigos, sem saída bruta — rejeitada

É segura e útil, mas não prova exatamente o que o modelo devolveu. Não atende ao objetivo que motivou esta especificação.

## 7. Topologia

```text
OpenAI
  -> raw output somente em memória
  -> parse estrutural canônico
     -> aceito: segue V2, sem evidência
     -> rejeitado: captura criptografada + fallback V2
  -> validação semântica
     -> aceita: segue V2, sem evidência
     -> rejeitada: captura criptografada + fallback/handoff V2

Verbalizador V2
  -> texto somente em memória
  -> ResponseValidator
     -> aceito: segue para outbox
     -> rejeitado: captura criptografada + fallback determinístico

Owner
  -> resumo sanitizado tenant-scoped
  -> ação explícita para revelar uma evidência vigente
  -> autorização Owner + auditoria
  -> decrypt somente em memória + resposta no-store
```

## 8. Contrato da captura

A application layer define uma porta estreita, sem dependência de Drizzle ou OpenAI:

```ts
type AiContractRejectionStage =
  | "understanding_structural"
  | "understanding_semantic"
  | "response_verbalization";

type AiContractRejectionIssue = Readonly<{
  path: readonly string[];
  code: string;
}>;

type CaptureAiContractRejectionInput = Readonly<{
  organizationId: string;
  conversationId: string;
  inboundEventId: string;
  turnId: string;
  stage: AiContractRejectionStage;
  modelId: string;
  promptVersion: string;
  contractVersion: string;
  attempt: number;
  rawOutput: string;
  issues: readonly AiContractRejectionIssue[];
  occurredAt: Date;
}>;
```

`path` contém somente nomes de campos ou índices; `code` pertence a um vocabulário fechado. Mensagem livre de Zod, valor recebido, stack, prompt e conteúdo não entram em `issues`.

O resultado da porta informa apenas:

- `stored`, com uma referência opaca;
- `deduplicated`;
- `oversized`;
- `encryption_unavailable`;
- `persistence_failed`.

O handler registra esse estado sanitizado no Decision Trace e continua a semântica V2 já definida.

## 9. Taxonomia de rejeição

### 9.1 Understanding estrutural

- `invalid_json` — texto não decodifica como JSON;
- `missing_output` — resposta aceita pelo provider sem conteúdo utilizável;
- `schema_type_mismatch` — tipo incompatível;
- `schema_required` — campo estrutural obrigatório ausente;
- `schema_unknown_key` — chave fora do contrato estrito;
- `schema_enum` — valor fora do vocabulário fechado;
- `schema_range` — número ou cardinalidade fora do limite.

`missing_output` não tem conteúdo para criptografar; a evidência preserva metadados com `capture_status=no_raw_output`. Erros HTTP, quota, autenticação, timeout e rede continuam como falhas de provider no Decision Trace e não fingem ser rejeições de contrato.

### 9.2 Understanding semântico

- `service_required_for_request`;
- `ambiguity_requires_candidates`;
- demais regras futuras com identificador determinístico versionado.

Regras semânticas não ficam escondidas em uma exceção genérica. Elas devolvem issues estruturadas e podem orientar clarificação, fallback ou handoff em mudanças funcionais separadas.

### 9.3 Verbalização da resposta

Os códigos já fechados do `ResponseValidator` são preservados, incluindo fatos, números, dinheiro, links, promessas, perguntas, mídia e tamanho não autorizados. A evidência guarda o texto gerado pelo modelo que foi rejeitado; nunca o plano completo, prompt ou histórico.

## 10. Contrato estrutural único

O schema Zod estrutural passa a ser exportado por `domain-packs/dental/understanding` como fonte canônica. O adapter OpenAI usa `zodResponseFormat` do SDK instalado para produzir o JSON Schema apresentado ao modelo. O mesmo schema Zod parseia o conteúdo retornado.

Regras que o JSON Schema do provider não representa de forma lossless, como “determinadas intenções exigem `entities.service`”, saem do `superRefine` estrutural e entram em um validador semântico separado. Assim:

- o modelo e o parser compartilham o mesmo contrato estrutural;
- uma regra semântica continua determinística;
- a rejeição informa `understanding_semantic`, e não `unknown`;
- alterar o contrato em dois lugares deixa de ser necessário.

Um teste arquitetural impede reintroduzir um JSON Schema manual no adapter live.

## 11. Schema durável

Toda alteração começa em `src/infrastructure/db/schema.ts` e usa `drizzle-kit generate`. SQL gerado não é editado à mão.

### 11.1 `ai_contract_rejections`

| Coluna | Regra |
| --- | --- |
| `id` | UUID, chave primária |
| `organization_id` | UUID não nulo, FK para `organizations`, tenant da evidência |
| `conversation_id` | UUID não nulo, FK para `conversations` |
| `inbound_event_id` | UUID não nulo, FK para `inbound_events` |
| `turn_id` | texto não nulo, igual ao inbound do turno live |
| `stage` | vocabulário fechado dos três estágios |
| `model_id` | identificador do modelo |
| `prompt_version` | versão estável do prompt |
| `contract_version` | versão do contrato que rejeitou |
| `attempt` | inteiro entre 1 e o budget do estágio |
| `issues` | JSONB sanitizado, não vazio, somente `path` e `code` |
| `output_sha256` | digest hexadecimal do conteúdo bruto antes da criptografia |
| `output_bytes` | tamanho UTF-8 original |
| `capture_status` | `stored`, `oversized`, `no_raw_output`, `encryption_unavailable`, `expired` |
| `encrypted_output` | ciphertext nullable; obrigatório somente em `stored` |
| `raw_expires_at` | criação + 7 dias |
| `metadata_expires_at` | criação + 30 dias |
| `created_at` | horário da rejeição |

O schema adiciona `UNIQUE (id, organization_id)` a `inbound_events`, equivalente ao contrato já existente em `conversations`. A evidência usa FKs compostas `(conversation_id, organization_id)` e `(inbound_event_id, organization_id)`. Um check exige `turn_id = inbound_event_id::text`.

A inserção é um único `INSERT ... SELECT` bounded a partir do inbound e do stream ativo, exigindo que `whatsapp_streams.conversation_id` seja a conversation informada. Assim, banco e statement provam simultaneamente tenant, inbound, stream e conversation; não existe sequência application read-then-write para validar identidade.

`raw_expires_at <= metadata_expires_at`, tamanho não negativo, `issues` não vazio e combinação `capture_status/encrypted_output` são checks de banco. `stored` exige ciphertext; `expired`, `oversized`, `no_raw_output` e `encryption_unavailable` exigem ciphertext nulo.

A unicidade `(organization_id, turn_id, stage, output_sha256)` deduplica a mesma rejeição em retry sem apagar saídas diferentes do mesmo turno.

Índices:

- `(organization_id, created_at desc)` para lista Owner;
- `(organization_id, turn_id, created_at)` para correlação;
- `(raw_expires_at)` parcial quando `encrypted_output is not null`;
- `(metadata_expires_at)` para limpeza.

O digest não vai para Decision Trace ou logs. Ele serve apenas para dedupe e verificação interna dentro da tabela protegida.

### 11.2 `ai_contract_rejection_access_audits`

Cada revelação do conteúdo bruto registra:

- `id`;
- `organization_id`;
- `rejection_id`;
- subject estável da sessão Owner;
- ação fechada `raw_output_revealed`;
- `accessed_at`;
- `expires_at`, limitado a 30 dias.

O audit usa FK composta `(rejection_id, organization_id)` e `on delete cascade`. Seu `expires_at` é copiado de `ai_contract_rejections.metadata_expires_at`, portanto nunca sobrevive aos metadados nem estende a retenção aprovada. O audit não contém saída, issue values, telefone, mensagem ou IP. Se o audit não puder ser persistido, a saída bruta não é devolvida.

## 12. Criptografia

Uma boundary nova `ai-evidence-vault` usa o padrão AES-256-GCM já conhecido pelo repositório, mas com chave própria `AI_EVIDENCE_ENCRYPTION_KEY`. A chave de credenciais não é reutilizada: credenciais e evidências têm finalidade, rotação e retenção diferentes.

O envelope versionado usa:

- IV aleatório por evidência;
- authentication tag GCM;
- AAD canônico contendo versão, `organization_id`, `rejection_id`, `turn_id` e `stage`;
- prefixo de formato próprio, por exemplo `aiev:v1`.

O AAD impede mover um ciphertext válido para outro tenant, turno ou estágio. A chave nunca entra no banco, logs, CI output ou navegador. O plaintext existe somente na memória do adapter no momento da captura e, quando autorizado, na resposta server-side ao Owner.

O limite do conteúdo bruto é 64 KiB UTF-8. Acima disso, a linha mantém hash, tamanho, issues e `capture_status=oversized`, sem truncar e sem ciphertext. Uma saída truncada nunca é apresentada como evidência completa.

## 13. Captura no runtime

### 13.1 Understanding

`OpenAIDentalUnderstandingModel` preserva o texto bruto somente até o parse. A boundary de geração devolve um envelope `{ rawOutput, decodedOutput }`; JSON inválido continua oferecendo `rawOutput` à captura.

`DentalUnderstandingProvider` executa em ordem:

1. decode JSON;
2. parse do schema estrutural canônico;
3. validação semântica;
4. entrega do `Understanding` aceito.

Cada rejeição chama a porta de evidência com contexto de execução separado do conteúdo enviado ao modelo. `organizationId`, conversation, inbound e `turnId` nunca são incluídos no prompt por causa dessa captura.

### 13.2 Verbalização

O verbalizador continua devolvendo seu texto ao `ResponseValidator`. Quando o validator escolhe fallback por violação do texto do modelo, o handler captura o texto rejeitado, os códigos fechados e as versões antes de produzir o fallback determinístico.

Falha ou timeout do provider sem texto retornado não cria ciphertext. Fallback determinístico não é “saída de IA rejeitada” e permanece apenas no trace sanitizado.

### 13.3 Semântica de falha

A gravação é awaited para não depender de trabalho solto depois do término da invocation, mas tem uma única inserção bounded. Erro de criptografia ou persistência é capturado na boundary de observabilidade:

- não altera o resultado do validator;
- não impede fallback seguro;
- não reexecuta modelo ou capability;
- não cria job, polling ou retry de negócio;
- registra somente `evidence_capture_status` e alerta sanitizado.

## 14. Consulta Owner

O resumo aparece junto ao Decision Trace da conversa e contém apenas metadados. A revelação exige uma ação explícita para uma evidência individual.

O endpoint/server action:

1. exige sessão `owner` pelo mecanismo canônico;
2. recebe `organization_id` e `rejection_id` explícitos;
3. busca pela combinação exata, sem fallback por nome;
4. recusa ciphertext expirado ou ausente;
5. valida AAD durante a descriptografia;
6. persiste o audit de acesso;
7. somente então devolve o plaintext com `Cache-Control: no-store`.

Cross-tenant e existência não autorizada retornam o mesmo resultado fechado, sem confirmar que a evidência existe. Staff clínico, tenant admin, cron e endpoint de conversa comum nunca recebem o conteúdo bruto.

## 15. Retenção e limpeza

O cron existente `decision-trace-cleanup` incorpora duas operações bounded, sem novo cron, polling ou worker contínuo:

1. até 500 evidências por execução têm `encrypted_output` nulled e `capture_status=expired` quando `raw_expires_at <= now`;
2. até 500 metadados/audits expirados por execução são removidos quando `metadata_expires_at/expires_at <= now`.

A limpeza é idempotente, indexada e tenant-neutral apenas porque atua exclusivamente por expiração, sem alterar configuração ou dados de conversa. Ela nunca apaga inbound, message, outbound, job ou Decision Trace antes da retenção própria.

## 16. Privacidade e segurança

- A nova tabela integra a cobertura de purge permanente do tenant.
- O PR roda `scripts/check-purge-coverage.ts` no banco descartável conforme o change-control.
- Exports, replays e suporte não incluem ciphertext por padrão.
- Serializadores têm allowlist; `encrypted_output` não participa de modelos de lista.
- Testes procuram plaintext sentinela em logs, trace, erros, snapshots e respostas não Owner.
- Erros de descriptografia não devolvem detalhes criptográficos.
- Nenhuma query Owner aceita apenas `rejection_id`; sempre exige o tenant exato.
- O acesso bruto é individual, no-store e auditado; não existe download em massa no primeiro corte.

## 17. Performance e custo

O caminho aceito, que é o comum, não adiciona query, round trip ou escrita. Ele apenas usa o schema estrutural canônico já necessário para o parse.

O caminho rejeitado adiciona:

- uma criptografia local de no máximo 64 KiB;
- uma inserção HTTP curta no PostgreSQL;
- nenhuma chamada adicional ao modelo;
- nenhum job ou outbound adicional além do fallback já existente.

Gates mensuráveis em banco descartável:

- zero query adicional em turnos aceitos;
- exatamente uma inserção ou dedupe em turnos rejeitados;
- criptografia p95 <= 5 ms para 64 KiB na máquina de CI;
- overhead p95 da captura persistida <= 250 ms em PostgreSQL warm;
- limpeza limitada a 500 linhas por operação;
- query Owner por índice, sem scan global;
- nenhuma nova atividade Neon quando o sistema está ocioso, pois o cron existente absorve a limpeza;
- ciphertext nunca aparece no resultado das consultas de lista.

## 18. Estratégia de migration e rollout

1. RED: reproduzir a divergência `request` que exige serviço com `service=null` e provar ausência de evidência exata.
2. Expand: adicionar tabelas, constraints e índices em `schema.ts`; gerar migration com Drizzle e revisar SQL destrutivo.
3. Adicionar cofre de evidência e repositório com testes de criptografia, AAD, dedupe e tenant isolation.
4. Separar schema estrutural e regras semânticas; gerar o formato OpenAI pelo helper Zod do SDK.
5. Integrar captura no Understanding e verbalizador, mantendo fallback e authority inalterados.
6. Adicionar resumo e revelação Owner auditada.
7. Integrar limpeza bounded ao cron existente e purge permanente.
8. Configurar `AI_EVIDENCE_ENCRYPTION_KEY` antes do deploy; readiness verifica presença sem imprimir valor.
9. Aplicar migration aditiva antes de ativar captura no build.
10. Validar em SystemOpsLab com fixture/replay isolado que force rejeição; não enviar WhatsApp sintético em produção.
11. Observar apenas contagens, status de captura, latência e erros sanitizados.

Não há backfill: saídas históricas não persistidas não podem ser reconstruídas honestamente. Rollback desativa a composição do capture port e preserva as linhas até sua expiração; a migration é aditiva e não exige remoção emergencial. A resposta segura V2 continua funcionando mesmo sem a evidência.

## 19. Testes obrigatórios

### Contrato e captura

1. JSON inválido gera `understanding_structural/invalid_json` com raw criptografado.
2. Estrutura inválida gera paths/codes sanitizados sem valores.
3. Intenção de serviço sem serviço gera `understanding_semantic/service_required_for_request`, não `unknown`.
4. Verbalização inválida preserva o texto rejeitado e usa o fallback determinístico existente.
5. Saída aceita não cria evidência.
6. Falha HTTP/timeout sem output não fabrica ciphertext.
7. Retry idêntico deduplica; output diferente permanece como evidência distinta.

### Segurança

8. Banco, trace e logs não contêm plaintext fora do ciphertext.
9. AAD impede descriptografar a evidência sob outro tenant/turno/estágio.
10. Owner do sistema revela uma evidência vigente e gera audit.
11. Staff, sessão ausente e tenant divergente não revelam nem confirmam existência.
12. Falha ao gravar audit impede a revelação.
13. Saída acima de 64 KiB guarda somente hash/tamanho/status.

### Retenção e operação

14. Dry cleanup não é necessário; o cron idempotente expira ciphertext após 7 dias e metadados/audits após 30.
15. Cleanup não altera mensagens, inbound, jobs, outbounds ou outro tenant.
16. Purge permanente remove evidências e audits do tenant.
17. Falha de captura não muda fallback, handoff, outbox ou estado do job.
18. Turno aceito mantém zero round trips adicionais.

### Paridade

19. Adapter OpenAI não contém JSON Schema manual para Understanding live.
20. O schema usado em `zodResponseFormat` é o mesmo usado no parse estrutural.
21. Regras semânticas retornam issues fechadas e nunca dependem de mensagem de exceção.

### Verificação

- testes focados RED -> GREEN -> refactor;
- testes de Decision Trace, Understanding, verbalização e fallback;
- PostgreSQL descartável com zero skips;
- schema e migration metadata;
- purge coverage;
- lint, typecheck e `npm run verify` em árvore limpa;
- build em clone limpo;
- CI, Migration CI e Vercel verdes.

## 20. Critérios de conclusão

A mudança está concluída quando:

1. qualquer saída V2 rejeitada após retorno do modelo produz causa estruturada;
2. uma evidência bruta vigente pode ser revelada somente pelo Owner e pelo tenant exato;
3. o conteúdo bruto nunca aparece em trace ou logs;
4. ciphertext expira em 7 dias e metadados/audits em 30;
5. o incidente `service=null` deixa de aparecer como `unknown`;
6. schema estrutural apresentado à OpenAI e parser têm uma única fonte;
7. turnos aceitos não ganham query ou custo Neon adicional;
8. falha da evidência nunca altera atendimento ou cria duplicação;
9. migrations são aditivas, geradas e verificadas em banco descartável;
10. nenhum tenant é ativado, modificado ou consultado fora do escopo explícito por causa desta feature.
