# ADR-011: Limites de capacidade e ativação do runtime V2

**Status:** Aceito — implementação adiada
**Data:** 2026-09-02
**Escopo:** registrar o resultado da auditoria V2 sem alterar runtime, schema, configuração, workflow ou produção

## Contexto

O runtime produtivo é V2-only. A V1 permanece apenas como referência histórica e não pode ser
selecionada como runtime ou fallback. O desenho vigente separa entendimento e verbalização das
autoridades determinísticas de negócio, exige authority version 2 para respostas live e mantém
outbox, sender, consentimento, takeover e safety gates como fronteiras irreversíveis.

A auditoria de 2026-09-02 verificou que o SystemOpsLab continuava saudável: era o único tenant live
revisado, a authority version 2 não tinha métricas bloqueantes, não havia job ou outbound ativo e o
controle global estava aberto. Nos sete dias observados, 25 traces incluíam, em categorias
sobrepostas, sete entregas, vinte turnos ignorados por política e duas falhas históricas; não havia
terminal ausente. A última falha era anterior ao release mais recente de expansão de capacidades,
e não havia rejeição de contrato de IA no período.

A [matriz de paridade V2](../v2-capability-parity.md) mapeia 17 comportamentos produtivos, 26 classes
de pedido inbound e cinco automações proativas. Isso comprova uma superfície de negócio ampla, mas
não autoriza afirmar que toda frase, todo canal ou todo segmento já tem paridade produtiva.

## Decisão

Manter o runtime V2 atual em produção sem implementar agora as ampliações encontradas pela
auditoria. Os limites ficam registrados como requisitos de entrada para trabalhos futuros, e não
como autorização para ativar tenant, alterar schema ou aumentar o escopo do runtime.

Continuam valendo estes invariantes:

- não existe fallback para V1;
- deploy não ativa tenant;
- tenant sem `conversation_authority.version >= 2` permanece fail-closed;
- habilitação live é tenant-scoped, validada e feita por compare-and-set;
- conteúdo sem autoridade suficiente termina em esclarecimento, resposta segura ou handoff;
- nenhuma inferência do modelo autoriza preço, agenda, consentimento ou outro efeito de negócio.

## Limites auditados

### 1. O portal não representa toda a autorização live

Os fluxos owner `activateClinicGoLive` e `toggleClinicAutomation` administram auto-reply, status e
modo de teste, mas não comprovam nem configuram toda a fronteira live: permissão live explícita e
authority version 2. O runtime nega a execução de forma segura, porém a interface pode apresentar
“IA ativa” sem que a automação esteja efetivamente autorizada.

O script do primeiro corte V2 é específico do SystemOpsLab. A evolução futura deve fornecer uma
única readiness tenant-scoped, reutilizar a ativação monotônica de authority e mostrar na UI o
estado real (`live`, `observe` ou `disabled`) com seus bloqueios.

### 2. O domínio conversacional ainda é dental

O runtime cria o pacote dental de forma explícita. O onboarding aceita dezesseis segmentos, mas não
existe hoje uma autoridade persistida que selecione o domínio conversacional. O campo `segment`
não pode ser usado como proxy: o próprio SystemOpsLab possui um valor de segmento genérico embora
execute o domínio dental revisado.

Antes de ativar um segundo tenant, o sistema deve possuir uma autoridade de domínio explícita. Um
domínio não suportado permanece fail-closed; não recebe silenciosamente o pacote dental e não é
encaminhado à V1.

### 3. A paridade de canal não é uniforme

- Z-API recebe texto, áudio, imagem, vídeo e documento.
- Sticker e reação podem ser registrados sem resposta automática.
- Localização e contato não possuem tratamento produtivo equivalente.
- O parser inbound da Meta aceita somente texto.
- Mídia outbound da Meta usa fallback de link em legenda, não upload de mídia equivalente.

Esses limites devem aparecer como capacidade do canal, não como comportamento implícito do
orquestrador.

### 4. O corpus não prova qualquer formulação linguística

O corpus final contém 31 cenários, um para cada uma das 26 classes inbound e cinco automações
proativas. O corpus histórico contém 66 casos, enquanto o manifest dental do Cycle F exercita
dezessete. A cobertura é suficiente para as classes mapeadas, mas não prova paráfrases ilimitadas,
ambiguidades, adversariais ou combinações de pedidos.

### 5. Multi-intenção ainda não possui contrato explícito de entrada

O composer preserva múltiplos resultados de ação e verbalização segura por assunto. Entretanto, o
contrato de Understanding possui um único `request`. Mensagens com mais de um pedido produtivo não
têm ainda uma decomposição explícita e testada de múltiplos requests.

### 6. O E2E agendado de provider está obsoleto

O workflow manual de E2E também roda diariamente com tenant fixo e credenciais de provider. As dez
execuções mais recentes inspecionadas falharam; uma delas apontou configuração Z-API ausente no
tenant antigo. Isso gera ruído operacional e não mede a saúde atual do V2.

A evolução correta é separar smoke real de provider, manual e autorizado, de uma auditoria
agendada estritamente read-only.

## Evoluções futuras aceitas, mas não iniciadas

### Ativação real de tenant

1. Introduzir autoridade explícita de domínio conversacional somente se a implementação provar que
   nenhuma fonte canônica existente representa esse dado; isso pode exigir migration própria.
2. Criar readiness genérica que avalie tenant, domínio, authority, canal, configuração, safety e
   kill switch.
3. Manter a authority monotônica `0 -> 1 -> 2` com validação e compare-and-set.
4. Ativar live somente para o UUID revisado e somente após readiness limpa.
5. Exibir na UI o estado efetivo e seus bloqueadores, em vez de inferir live por auto-reply.

### Qualidade conversacional e canais

1. Ampliar primeiro o corpus com paráfrases, ambiguidades, adversariais e pedidos compostos.
2. Definir contrato explícito de decomposição de múltiplos pedidos antes de alterar o runtime.
3. Completar mídia Meta e respostas seguras para tipos inbound relevantes.
4. Manter reação/sticker sem resposta quando esse for o comportamento deliberado; conteúdo útil
   não suportado deve pedir esclarecimento ou gerar handoff.

### Operação

1. Tornar o E2E com provider exclusivamente manual e tenant-scoped.
2. Substituir o agendamento atual por health audit read-only sem envio.
3. Executar cada mudança em PR próprio, com RED -> GREEN -> refactor e medição de latência, modelo,
   tokens, banco e cardinalidade de jobs/outbounds.

## Gatilhos obrigatórios para retomada

- **Antes do segundo tenant live:** implementar verdade de ativação e autoridade explícita de
  domínio.
- **Antes de anunciar paridade de mídia Meta:** implementar transporte e testes ponta a ponta.
- **Antes de anunciar cobertura ampla de linguagem:** expandir o corpus e testar combinações.
- **Antes de confiar novamente no E2E agendado:** separar smoke manual de auditoria read-only.

Cada retomada precisa de especificação focada, regressão RED, rollout tenant-scoped e evidência de
que nenhum tenant pausado, desabilitado, demo, prospect ou sem authority v2 foi ativado.

## Alternativas rejeitadas

- **Tratar `autoReplyEnabled` como autorização live:** omite authority e demais gates.
- **Inferir domínio pelo `segment`:** o dado atual não representa essa responsabilidade de forma
  confiável.
- **Criar exceção hardcoded para o SystemOpsLab:** duplica autoridade e impede onboarding genérico.
- **Aplicar o pacote dental a todos os segmentos:** pode produzir respostas semanticamente erradas.
- **Construir todos os domínios agora:** amplia risco e complexidade sem demanda tenant-scoped
  validada.
- **Manter o E2E sintético diário como sinal de saúde:** mistura configuração histórica, provider e
  saúde de runtime num indicador ruidoso.
- **Usar a V1 enquanto a V2 evolui:** cria dois donos para o mesmo turno e rastreabilidade ambígua.

## Consequências

### Positivas

- preserva o runtime produtivo estável;
- evita uma implementação apressada ou uma arquitetura paralela;
- torna explícito o que já é comprovado e o que ainda exige evidência;
- impede que onboarding ou UI sejam confundidos com autorização live completa.

### Negativas e dívida aceita

- a UI owner pode continuar exibindo um estado otimista até a correção focada;
- novos tenants não possuem ativação live self-service completa;
- suporte fora do domínio dental não está comprovado;
- Meta mantém lacunas de mídia;
- o E2E diário antigo permanece ruidoso até um PR operacional separado.

## Não decidido nem autorizado por este ADR

- nenhuma ativação, pausa ou alteração do SystemOpsLab;
- nenhuma mudança em outro tenant;
- nenhuma migration, coluna, tabela ou backfill;
- nenhuma alteração de workflow, cron, provider ou credencial;
- nenhuma implementação de novo domain pack;
- nenhuma restauração de runtime ou fallback V1.

## Referências

- [Arquitetura atual](../current.md)
- [Arquitetura de capacidades V2](../v2-business-capability-architecture.md)
- [Matriz executável de paridade V2](../v2-capability-parity.md)
- [Rollout do runtime V2-only](../../operations/v2-only-runtime-rollout.md)
- [Onboarding de organização](../../operations/onboarding-clinica.md)
