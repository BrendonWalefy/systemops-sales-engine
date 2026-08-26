# Conversation Runtime V2-Only — arquitetura definitiva

**Data:** 2026-08-25

**Status:** direção aprovada pelo owner; correções arquiteturais obrigatórias incorporadas

**Escopo:** seleção do runtime conversacional, política operacional, falhas, entrega e retirada da V1 do caminho produtivo

## 1. Decisão

A Conversation Intelligence V2 passa a ser o único runtime conversacional executável do SystemOps para qualquer tenant. O runtime produtivo não consulta uma configuração de engine, não exige aprovação Internal Lab vinculada ao build e nunca encaminha um turno para a V1.

A V1 permanece temporariamente no repositório apenas como referência de implementação. Nenhuma rota, worker, composição de dependências ou recuperação de erro pode importá-la ou executá-la. O histórico Git é a fonte definitiva para consulta; a remoção física da V1 ocorrerá depois que a paridade necessária tiver sido convertida em capabilities V2 e testes.

Esta especificação substitui, somente para seleção e autorização do runtime live, as decisões de `v1`, `v1_with_v2_shadow`, `v2_internal`, approval por build e fallback para V1 descritas nas especificações de 2026-08-15 e 2026-08-17. Os contratos V2 de Understanding, capabilities, ActionResult, AuthorizedResponsePlan, validação, stream authority, inbox, jobs, outbox e sender continuam válidos.

## 2. Motivo

O selector por tenant cumpriu seu papel durante a construção e o dogfooding da V2, mas agora cria três custos incompatíveis com a direção do produto:

1. permite que lacunas da V2 permaneçam escondidas por fallback;
2. vincula a continuidade do Lab a uma approval que perde validade a cada commit;
3. mantém duas arquiteturas produtivas, duplicando diagnóstico, testes e evolução.

O corte V2-only transforma lacunas em trabalho explícito. Uma funcionalidade necessária deve existir como capability, policy ou serviço compartilhado da V2; ela não pode ser recuperada chamando a V1.

## 3. Princípios e invariantes

1. **Uma engine:** todo turno automatizado elegível usa `V2LiveConversationHandler`.
2. **Nenhum fallback V1:** erro, configuração ausente ou capability não suportada termina dentro da V2.
3. **Configuração não escolhe engine:** `organizations.conversation_engine` deixa de participar do runtime.
4. **Approval não autoriza runtime:** approval Internal Lab, gate reports e artefatos de avaliação não controlam atendimento live.
5. **Controles operacionais permanecem:** status operacional, `live_automation_enabled`, `auto_reply_enabled`, shadow/observe, takeover humano, consentimento, quiet hours e safety gates continuam bloqueando efeitos quando aplicável. `live_automation_enabled` é tenant-scoped, default false, não seleciona engine e não depende de build.
6. **O LLM entende e verbaliza; o sistema decide:** modelos não autorizam fatos, agenda, estado, envio ou efeitos.
7. **Evidência antes de resposta:** ActionResults e AuthorizedResponsePlan limitam o que pode ser dito.
8. **Durabilidade preservada:** stream authority, claim, dedupe, retry, outbox e sender continuam sendo as fronteiras irreversíveis.
9. **Isolamento por tenant:** toda leitura, capability, ação, outbox e trace conserva o `clinicId` resolvido no webhook/job.
10. **Falha visível:** nenhuma falha é mascarada por V1; trace, atenção humana e estado terminal/retry tornam a causa observável.
11. **Authority V2 obrigatória:** qualquer automação `live` exige `conversation_authority.version >= 2`. Ausência da linha, versão 0/1 ou leitura inconclusiva termina fail-closed, sem V1, sem outbound e sem ativação implícita.
12. **Ativação explícita:** futuras ativações são tenant-scoped, precedidas por validação limpa e avançam a authority por compare-and-set monotônico. Deploy, `is_test`, status ou configuração editorial nunca promovem authority.
13. **Kill switch global:** um controle global fail-closed bloqueia tanto a criação quanto a entrega de novos outbounds live. Ele complementa os freios por tenant e nunca redireciona trabalho para a V1.
14. **Dupla autorização:** criação de outbox e entrega são decisões separadas. O sender revalida o estado atual imediatamente antes do provider; autorização persistida não é passe irrevogável para envio.

## 4. Topologia alvo

```text
WhatsApp webhook
  -> registro durável de inbound + stream/generation + job
  -> claim durável e quiet-window
  -> política operacional do tenant
     -> disabled/observe/takeover: histórico e término sem engine de resposta
     -> live permit + authority >= 2 + kill switch aberto: V2LiveConversationHandler
        -> LiveTurnLifecycle
        -> Understanding estruturado
        -> coordenação de capabilities
        -> Decision determinística
        -> execução + ActionResult com provenance
        -> AuthorizedResponsePlan
        -> composer/verbalizer
        -> validator/fallback V2
        -> outbox live_stream_reply
  -> sender
     -> preflight completo de authority + política atual + safety + kill switch
     -> provider
```

`createConversationV2Runtime()` passa a compor diretamente o handler V2. `TenantEngineRouter`, `ConversationEnginePolicyReader`, `InternalLabAutomationPolicyReader` e `InternalLabDeliveryGuard` não participam desse fluxo.

## 5. Política operacional

V2-only não significa resposta automática incondicional. A escolha da engine desaparece, mas os controles de operação continuam determinísticos:

- `auto_reply_enabled=false`: registra histórico e não executa resposta automática;
- `live_automation_enabled=false`: mantém somente aquele tenant fail-closed;
- status pausado ou cancelado: não executa resposta automática;
- takeover humano ativo: preserva o inbound e não disputa com o operador;
- shadow/observe: não produz efeitos produtivos nem outbound real;
- authority ausente ou abaixo de 2: não executa resposta automática e não cria outbound;
- kill switch global fechado, ausente ou ilegível: não cria nem entrega outbound live;
- live: executa exclusivamente a V2 quando todos os gates acima permitem.

O SystemOps Dental Lab permanece identificado por `is_test=true`, mas assume `operational_status=active`, `live_automation_enabled=true`, `auto_reply_enabled=true` e `shadow_mode_enabled=false`. Isso usa a mesma política live de qualquer tenant, sem exceção por UUID. `is_test` continua classificando os dados e o ambiente; não seleciona engine.

Antes do corte, uma auditoria read-only deve provar quais tenants estão em condição live e quais possuem authority V2. O deploy não pode ativar silenciosamente tenant pausado, desabilitado, cancelado, prospect, demo, sem authority V2 ou com auto-reply desligado. Esses tenants conservam exatamente seu estado operacional e não recebem escrita de ativação durante o corte.

## 6. V2 como reconstrução, não cópia

A V2 reaproveita os contratos estáveis da plataforma e reconstrói a inteligência conversacional:

- reutiliza webhook, durable inbox, stream authority, jobs, `LiveTurnLifecycle`, repositórios, `BookingService`, outbox, sender e adapters de canal;
- substitui a coordenação monolítica da V1 por Understanding, capabilities, Decision, ActionResult e plano de resposta autorizado;
- mantém regras de negócio em código determinístico e conteúdo editorial nos donos canônicos;
- usa domain packs para comportamento do segmento sem contaminar o conversation core.

As capabilities odontológicas atuais — catálogo, agenda, escalação e recepção — são o início do runtime definitivo. Qualquer comportamento produtivo da V1 ainda necessário deve ser modelado no pack V2 com contrato e teste próprios. Copiar condicionais do `ConversationOrchestrator` para o handler V2 é proibido.

## 7. Paridade funcional orientada a capacidades

Antes do deploy, deve existir uma matriz de comportamentos produtivos observados, não uma comparação linha a linha com a V1. Cada item recebe uma destas decisões:

- já coberto por capability V2;
- coberto por serviço compartilhado fora da engine;
- comportamento obsoleto que não será migrado;
- lacuna bloqueante que exige capability/teste V2 antes do corte;
- lacuna não bloqueante que termina em resposta segura ou handoff explícito.

A matriz deve incluir, no mínimo: abertura e recepção, catálogo/tratamentos, preço autorizado, objeções, pipeline multi-turn, mídia, qualificação, agenda e revalidação, reserva, sinal, cancelamento/remarcação, opt-out, handoff, takeover, follow-up relacionado ao turno e configurações de voz.

Nenhuma lacuna pode ter “usar V1” como resolução.

## 8. Semântica de falha sem V1

Falhas são tratadas conforme o ponto de irreversibilidade:

### Antes de qualquer efeito

- nenhuma V1 é chamada;
- a V2 registra `turn.failed` com fase e código fechado;
- quando configuração e canal já estiverem resolvidos, pode criar exatamente uma resposta segura determinística;
- o turno é marcado para atenção humana quando a falha não puder ser resolvida automaticamente.

### Depois de um efeito tentado ou concluído

- resposta genérica que contradiga o efeito é proibida;
- a authority e o claim originais permanecem válidos para retry do mesmo turno;
- a resposta deve derivar do ActionResult persistido/confirmado ou seguir para handoff explícito;
- não se recomputa o efeito e não se chama V1.

### Falha de outbox ou sender

- outbox falha antes de commit: o job permanece retryable com a mesma authority;
- outbox confirmada: sender retenta a entrega sem recompor a conversa;
- falha terminal vira dead letter/atenção, nunca fallback de engine;
- dedupe por turno e stream impede uma segunda resposta live.

Ausência de provider de Understanding, configuração inválida ou capability conflict são falhas V2 observáveis. Nenhuma delas autoriza silêncio indefinido ou execução da V1.

### 8.1 Budget de retry e estados terminais

O budget pertence ao job durável, não a loops internos da engine. Cada execução usa a mesma authority, claim, `turnId`, ActionResults persistidos e chaves de dedupe:

| Fase | Budget | Regra de retry | Estado terminal |
| --- | --- | --- | --- |
| processamento antes de efeito | no máximo 3 claims do mesmo `message.process`; backoff durável de 5 s e 10 s antes da terceira tentativa | pode repetir somente leitura/Understanding não confirmada; nenhum loop inline além do retry tipado já pertencente ao adapter de modelo | exatamente uma resposta segura determinística, se autorizável, ou `handoff_required`; job `dead` somente depois de registrar a resolução terminal |
| efeito tentado/concluído | no máximo as 3 execuções do mesmo job, sem executar novamente efeito com receipt existente | relê o ActionResult/receipt; nunca recompõe ou reaplica o efeito | outbox derivada do resultado confirmado ou `handoff_required`; falha fica auditável |
| criação atômica da outbox | usa o budget restante do mesmo process job | repete a mesma operação idempotente e a mesma dedupe key | uma outbox ou handoff; nunca duas respostas |
| entrega ao provider | no máximo 10 claims do mesmo `message.send`, preservando o contrato atual e backoff exponencial limitado a 15 min | relê a mesma outbox; não chama modelo, capability ou composer | `sent`, `cancelled` por preflight, ou `dead` com atenção humana |

`handoff_required`, `sent`, `cancelled` e `dead` são terminais para o turno/outbound correspondente. Um reconciliador pode recuperar lease órfão, mas não pode zerar tentativas, criar token, recompor efeito ou gerar outra outbox. O monitor alerta antes e no esgotamento do budget. Assim, todo turno live termina em no máximo uma resposta segura autorizada ou handoff explícito; não há silêncio indefinido, loop ilimitado nem efeitos recompostos.

## 9. Entrega e remoção do binding Internal Lab

O payload live V2 atual carrega `internalLabBinding` e o sender exige uma approval Internal Lab antes da entrega. Esse contrato é temporário e deve sair do caminho produtivo.

O sender V2-only usa as autoridades já duráveis:

- `organization_id` e `conversation_id` do outbound;
- `authorization_kind=live_stream_reply`;
- stream, geração, inbound, claim job e digest do token;
- authority version do tenant;
- configuração de canal resolvida pelo repositório tenant-scoped;
- safety gate, consentimento, takeover e ordem da conversa.

Imediatamente antes de qualquer chamada ao provider, uma única boundary fail-closed do sender relê e exige cumulativamente:

- `conversation_authority.version >= 2` para o tenant exato;
- correspondência exata de stream, geração, inbound event, claim job e digest do token persistidos no outbound;
- `operational_status=active`, `live_automation_enabled=true` e `auto_reply_enabled=true`;
- shadow/observe desativado;
- ausência de takeover humano;
- consentimento válido e ausência de opt-out;
- todos os safety gates e limites de entrega aplicáveis;
- kill switch global explicitamente aberto.

Falha, ausência ou inconsistência em qualquer leitura cancela ou bloqueia a entrega segundo o estado durável; não chama o provider e não tenta V1. A mesma política é consultada antes de criar `live_stream_reply`, reduzindo trabalho inútil, mas a revalidação no sender é obrigatória porque o estado pode mudar enquanto a outbox aguarda.

Nenhum digest de approval ou commit é necessário para enviar. Remover `internalLabBinding` e approval por build não relaxa authority, estado operacional, consentimento, takeover, safety ou kill switch. O mecanismo de captura sintética do Lab/replay continua isolado e explicitamente autorizado apenas nos adapters de teste; ele não condiciona o envio real.

## 10. Configuração e schema legados

O primeiro corte inclui expansões aditivas de segurança geradas pelo Drizzle: a tabela singleton `conversation_runtime_control` e `organizations.live_automation_enabled boolean not null default false`. A linha global usa chave estável `global`, `live_outbound_enabled boolean not null default false`, `version bigint not null`, `updated_at` e `updated_by`. Abertura e fechamento usam compare-and-set pela versão esperada; linha ausente, duplicada ou leitura falha significa switch fechado. A permissão tenant-scoped também nasce fechada e é alterada junto do status somente pelo CAS do tenant exato. As migrations nascem de `schema.ts` seguido de `drizzle-kit generate`; SQL gerado não é editado à mão.

O primeiro corte não precisa de migration destrutiva:

- `conversation_engine` permanece fisicamente como coluna legada, mas nenhuma consulta produtiva a lê;
- valores `v1`, `v1_with_v2_shadow` e `v2_internal` não alteram comportamento;
- testes arquiteturais impedem reintroduzir essa leitura;
- as variáveis `CONVERSATION_V2_INTERNAL_LAB_*` deixam de ser dependências do runtime live.

Depois de um ciclo estável V2-only, uma mudança de contrato separada remove coluna, enum, readers, router, approval live e código V1. Qualquer alteração de schema usa `schema.ts` e migration gerada por Drizzle; SQL gerado não é editado à mão.

Artefatos de avaliação, assinaturas de corpus, replay e revisão humana podem continuar existindo para governança de qualidade. Eles medem a V2, mas não ligam nem desligam atendimento.

## 11. Fronteira temporária da V1

Enquanto a V1 permanecer no repositório:

- nenhum arquivo em `src/app`, workers, composição de runtime ou sender pode importar `ConversationOrchestrator` como handler produtivo;
- nenhum erro V2 pode instanciar ou chamar V1;
- testes da V1 podem continuar apenas como evidência histórica até a funcionalidade correspondente ser classificada;
- um teste arquitetural percorre imports e falha se houver caminho produtivo até V1;
- documentação deve chamar a V1 de legado inalcançável, não de rollback.

Rollback operacional depois de existir um release V2-only comprovado significa: fechar o kill switch, desabilitar auto-reply quando necessário, preservar inbox/outbox, fazer handoff ou redeployar o último build V2-only estável. Voltar para V1 não é rollback aceito.

O primeiro release é uma exceção operacional importante: antes dele não existe build V2-only comprovadamente estável para redeploy. Seu rollback imediato é fechar o kill switch global, manter/retomar o SystemOpsLab pausado, preservar inbox/outbox e encaminhar atendimento humano enquanto uma correção forward é preparada. Redeploy de build V2-only passa a ser opção somente depois de um release V2-only saudável ter sido comprovado e registrado.

## 12. Observabilidade e investigação de respostas

O `turnId`/`inboundEventId` correlaciona:

```text
webhook -> stream/generation -> claim/job -> V2 stages
-> ActionResults -> response plan/validation -> outbound authority
-> send job -> provider acknowledgement
```

Decision Trace continua sanitizado e tenant-scoped. Deve permitir identificar:

- modo operacional e motivo de supressão;
- Understanding concluído/falho e código de falha;
- capabilities selecionadas e conflitos;
- decisões, efeitos tentados/concluídos e outcomes;
- plano autorizado e referências de evidência;
- validator, violações, verbalizador ou fallback determinístico;
- criação/dedupe da outbox;
- preflight e resultado de entrega;
- duração por estágio.

Trace não armazena telefone, prompt, corpo, resposta ou payload bruto. A investigação de linguagem combina mensagem visível no Inbox, metadados do trace e, quando necessário, replay sanitizado. A retenção atual de 30 dias deve permanecer explícita na operação.

## 13. Segurança e multi-tenancy

- O `clinicId` resolvido no webhook é imutável durante o turno.
- Configuração, catálogo, estado, agenda, outbox e canal devem pertencer ao mesmo tenant.
- Capabilities recebem ports já escopados; não descobrem tenant por nome ou fallback global.
- Outbound live exige a authority durável exata do inbound claimado.
- Duplicata de provider não cria novo turno nem resposta.
- Test tenants não se tornam live por `is_test`; apenas a política operacional explícita os habilita.
- Nenhuma mudança em produção pode atingir tenants por consulta ampla sem predicado e contagem revisada.
- Tenant pausado, desabilitado, demo, prospect ou sem authority V2 permanece inalterado e não é ativado pelo deploy.
- Ativação futura exige validação tenant-scoped, versão esperada exata e compare-and-set que avance uma versão; erro de concorrência não é reinterpretado como sucesso.
- O kill switch global fecha criação e envio live, mas não altera configuração, authority ou status de nenhum tenant.

## 14. Estratégia de implementação e corte

O trabalho será dividido em commits independentemente revisáveis:

1. contratos e testes arquiteturais V2-only, inicialmente RED;
2. matriz de paridade e capabilities bloqueantes ausentes;
3. composição direta do runtime V2 e política de falha sem V1;
4. entrega V2 normal sem `internalLabBinding`/approval;
5. remoção de router, policy reader e approvals do caminho produtivo;
6. atualização de documentação, comandos e testes legados;
7. verificação de banco descartável, replay e performance comparativa V1 atual × V2-only;
8. rollout controlado e ativação operacional do SystemOpsLab.

Cada fase segue RED -> GREEN -> refactor. Não se publica um runtime parcialmente V2-only que ainda possua fallback oculto.

## 15. Gates de verificação

### Arquitetura

- zero import produtivo de `ConversationOrchestrator`;
- zero uso produtivo de `TenantEngineRouter`;
- zero leitura produtiva de `conversation_engine`;
- zero dependência live de approval Internal Lab;
- zero caminho de erro que chama V1.

### Comportamento

- webhook, durable ingress, debounce, claim e history-only;
- todos os fluxos V2 classificados na matriz de paridade;
- efeitos exatamente uma vez e retries com a mesma authority;
- resposta segura/handoff em falhas por fase;
- outbox `live_stream_reply` e sender preflight;
- mídia, voz, agenda e state machine conforme aplicável;
- takeover, opt-out, automação desligada e tenant isolation;
- trace completo sem conteúdo sensível.

### Entrega

- testes unitários e integração V2;
- authority PostgreSQL com zero skips;
- replay fiel em banco isolado, sem provider real;
- `npm run verify` em árvore limpa;
- build em clone limpo;
- CI, Migration CI e preview verdes;
- auditoria read-only dos tenants live antes do deploy;
- smoke real apenas pelo owner do SystemOpsLab após autorização humana específica.

### Performance e custo

O commit-base anterior ao corte é o braço V1 atual; o candidato é o braço V2-only. A mesma população sanitizada, relógio, adapters e banco descartável deve medir os dois braços, sem provider ou tenant produtivo. O plano executável congela o relatório-base antes de alterar o runtime e aplica limites relativos e absolutos explícitos a:

- latência end-to-end e por estágio do turno, incluindo p50/p95;
- chamadas ao modelo por turno;
- tokens de entrada e saída;
- queries e round trips ao banco;
- duração e espera de locks por stream;
- jobs criados e outbounds criados por inbound;
- consumo Neon ocioso, incluindo compute-active time e wake-ups.

Jobs e outbounds têm gate estrutural absoluto: um provider event físico cria no máximo um `message.process`; uma geração settled cria no máximo um `live_stream_reply` e um `message.send`. O corte não introduz polling, heartbeat nem worker contínuo. Ausência de baseline mensurável é RED e não pode ser convertida em “sem regressão”.

## 16. Rollout e rollback

1. Implementar e validar em branch isolada a partir de `develop`.
2. Congelar baseline V1 e auditar, por metadados, todos os tenants que a política operacional considera live. O primeiro corte só prossegue se o SystemOpsLab for o único tenant live autorizado; qualquer outro caso exige decisão explícita e não sofre alteração automática.
3. Resolver toda lacuna bloqueante da matriz de paridade antes do merge.
4. Abrir o kill switch apenas no ambiente controlado de validação; em produção ele permanece fechado durante o corte.
5. Pausar temporariamente somente o SystemOpsLab com predicado pelo UUID, estado esperado e compare-and-set de exatamente uma linha. Authority permanece 2.
6. Drenar `message.process`, `message.send` e outbounds sendable. Registrar zero leases ativos, zero jobs pendentes/processando e zero outbounds pending/processing para o tenant.
7. Promover pelo fluxo `develop -> main` com CI verde e implantar o build V2-only ainda com o kill switch fechado.
8. Provar que nenhum worker/build antigo pode receber trabalho novo: produção aponta para o novo SHA; os invocations antigos foram drenados/expiraram; nenhuma URL de wake referencia deployment antigo; filas continuam vazias; jobs novos carregam o contrato V2-only aceito pelo novo composition root.
9. Validar runtime, sender, authority e isolamento em modo sem envio: nenhum import V1, authority 2 limpa, preflight completo, kill switch bloqueando criação e entrega, demais tenants sem mutação.
10. Abrir `conversation_runtime_control.live_outbound_enabled` por compare-and-set da versão global esperada e reativar somente o SystemOpsLab com compare-and-set de uma linha que também muda `live_automation_enabled` de false para true, mantendo `is_test=true`, auto-reply ligado e shadow desligado. O CAS usa uma transação HTTP não interativa curta e locks de escrita sobre os dados do fence; concorrência é serializada e nenhum outro tenant recebe a permissão.
11. Solicitar ao owner um único smoke real; não gerar mensagem sintética. Confirmar uma geração, um claim, V2 live, uma outbox autorizada, um send e zero duplicatas.
12. Remover variáveis de approval obsoletas somente após comprovar que o runtime e sender não as leem.

No primeiro corte, qualquer regressão fecha imediatamente o kill switch, pausa o Lab e transfere para handoff; a correção é forward. Depois que esse release for comprovado saudável, o último build V2-only estável também pode ser redeployado. É proibido restaurar roteamento V1 como correção emergencial.

## 17. Critério de conclusão

O corte está concluído quando:

1. toda automação live executa V2 e somente V2;
2. nenhum tenant ou erro alcança V1;
3. SystemOpsLab responde pela V2 sem approval por build;
4. controles operacionais continuam fail-closed;
5. todas as lacunas bloqueantes foram implementadas como capabilities/serviços V2;
6. authority, dedupe, outbox e sender permanecem íntegros;
7. respostas podem ser rastreadas do webhook ao provider por metadados;
8. V1 está marcada e testada como legado inalcançável;
9. documentação canônica descreve V2 como runtime único;
10. produção está estável sem jobs pendentes, duplicações ou efeitos cross-tenant.
11. todo live exige authority >= 2 e o sender revalida authority, claim, operação, consentimento, takeover, safety e kill switch;
12. tenants não elegíveis permanecem inalterados;
13. retries terminam em uma resposta segura ou handoff dentro do budget;
14. os gates comparativos não mostram regressão acima dos limites aprovados nem aumento relevante de Neon ocioso.

## 18. Fora de escopo deste corte

- remover imediatamente todos os arquivos e testes V1;
- remover a coluna `conversation_engine` no primeiro deploy;
- substituir PostgreSQL, Neon, Vercel, jobs ou outbox;
- alterar provider de IA apenas por causa do corte;
- reduzir safety gates, stream authority ou isolamento;
- ativar automaticamente tenants que não estejam operacionalmente live;
- usar conteúdo real não sanitizado em replay ou documentação.
