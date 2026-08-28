# Evidência de rejeição de contratos de IA

## Objetivo e limites

O runtime V2 registra evidência apenas quando uma saída textual do modelo é rejeitada pelo
contrato estrutural, semântico ou de verbalização. A trilha serve para explicar por que uma saída
foi recusada e melhorar contratos e prompts. Ela não decide respostas, não altera fallback, não
cria jobs ou outbounds e não autoriza entrega.

A listagem do owner mostra somente tenant, conversa, turno, estágio, códigos de violação,
modelo, tamanho, estado de captura e horários. O digest do output permanece restrito à deduplicação
e ao armazenamento interno; ele não é exposto pelo serializer da listagem. O conteúdo bruto só
pode ser revelado
individualmente por uma sessão owner, dentro do tenant exato e antes da expiração. Cada acesso
bem-sucedido é auditado antes de o conteúdo ser devolvido. Logs, Sentry, Decision Trace e exports
não recebem prompt, saída rejeitada, telefone, nome, URL ou payload da mensagem.

O reveal é uma ação explícita por `POST`, aceita somente requisição `same-origin`, responde sempre
com `Cache-Control: no-store` e devolve o mesmo `404` para falha de sessão, tenant, validade,
criptografia ou auditoria. Não use `GET`, links pré-carregáveis ou URLs compartilháveis para revelar
o conteúdo bruto.

## Chave e configuração

Crie uma chave dedicada com `openssl rand -hex 32` e publique-a somente no secret
`AI_EVIDENCE_ENCRYPTION_KEY` dos runtimes autorizados. A prontidão valida apenas presença e
formato de 64 caracteres hexadecimais; nunca imprima o valor. Não reutilize chave de sessão,
webhook, replay ou criptografia de configuração.

`AI_EVIDENCE_CAPTURE_ENABLED=true` habilita a composição do recorder. Valor ausente preserva o
default habilitado. `false` desliga a captura de modo fail-closed. Valor vazio explícito ou qualquer
outro valor é configuração inválida. No boundary de build de produção, captura habilitada exige uma
chave válida e configuração ambígua bloqueia o deploy com código sanitizado, sem imprimir o valor.
Preview e build local não recebem essa exigência de prontidão de produção.

A persistência de uma evidência tem orçamento máximo de **1.500 ms** e propaga `AbortSignal` até a
mesma conexão Neon HTTP usada pela aplicação. Timeout, indisponibilidade ou rejeição do banco
devolvem somente `persistence_failed`; nunca atrasam indefinidamente nem substituem o fallback seguro
que já foi determinado para o usuário.

Perder a chave torna o conteúdo bruto já persistido irrecuperável, embora seus metadados
continuem disponíveis até a retenção terminar. Como a primeira versão não persiste identificador
de chave, faça rotação somente depois do TTL de todo conteúdo bruto antigo ou mediante decisão
explícita de aceitar sua perda.

## Migração e rollout

1. Gere e revise as migrações pelo fluxo Drizzle do repositório.
2. Aplique primeiro `0104`, que cria a chave composta exigida no ledger inbound.
3. Aplique depois `0105`, que cria enums, evidências, auditorias, índices e referências.
4. Valide as duas migrações em banco descartável vazio e em cópia descartável do schema atual.
5. Publique a chave dedicada e verifique apenas presença/formato.
6. Implante o build e confirme captura, listagem metadata-only, reveal auditado e limpeza limitada.

O rollout é **sem backfill**: eventos e mensagens antigos não são lidos nem reconstruídos. As
migrações são aditivas e a captura começa apenas para novas rejeições observadas pelo build.

A migração `0104` precisa verificar todas as linhas existentes para criar a restrição única e pode
esperar por um lock incompatível em `inbound_events`. Aplique-a com workers drenados e em janela
controlada; monitore lock wait e duração da transação e interrompa o rollout se exceder o orçamento
revisado. Só prossiga para `0105` após a restrição estar válida. Não altere o SQL gerado manualmente.

## Retenção e limpeza

- O envelope criptografado expira em **7 dias**. A limpeza remove o envelope e marca a captura como
  expirada, preservando o diagnóstico metadata-only. O hash do output não é digest de chave; ele
  permanece metadado interno durante os 30 dias e não aparece na listagem do owner.
- Metadados da rejeição e auditorias de acesso expiram em **30 dias** e são removidos juntos.
- Cada operação processa no máximo 500 linhas e reutiliza o cron existente de limpeza. Não há
  polling, heartbeat, cron adicional ou worker contínuo.
- O purge de um tenant de teste cancelado remove primeiro auditorias e evidências daquele UUID;
  não alcança outro tenant.

Os contadores `aiContractRejectionRawExpired` e `aiContractRejectionMetadataDeleted` tornam cada
execução mensurável sem revelar conteúdo. As flags `aiContractRejectionRawBacklogPossible` e
`aiContractRejectionMetadataBacklogPossible` ficam verdadeiras quando uma etapa atinge o limite de
500 e pode ter deixado dívida. Nesse caso, interrompa o rollout, investigue a taxa de rejeições e
repita manualmente o cleanup autorizado até as duas flags ficarem falsas. Antes do deploy, valide
que o pico diário esperado fica abaixo de 500; a partir de 400, revise capacidade e frequência do
cleanup sem criar polling, heartbeat, novo cron ou worker contínuo. As leituras também aplicam os
TTLs no SQL, portanto registros fisicamente atrasados nunca voltam a aparecer nem podem ser revelados.

## Diagnóstico seguro

1. Localize o turno pelo `turnId`/`inboundEventId` e abra a trilha da conversa como owner.
2. Compare estágio, códigos fechados, modelo, tamanho e estado de captura.
   Em `response.validated`, use também `responseStrategy`, `understandingCalls` e
   `verbalizationCalls` para distinguir o caminho híbrido contextual do renderer determinístico.
   Esses campos são metadados fechados e nunca contêm mensagem ou resposta.
3. Revele uma única evidência somente quando o conteúdo for indispensável à investigação.
4. Confirme que o acesso auditado foi persistido. Falha de tenant, validade, chave, AAD ou
   auditoria responde de forma uniforme e não revela existência nem detalhe criptográfico.

## Rollback operacional

Para interromper novas capturas, publique `AI_EVIDENCE_CAPTURE_ENABLED=false` e redeploye o mesmo
build. Não reverta schema nem apague evidência antecipadamente: registros existentes seguem os
TTL de 7 dias e 30 dias.

Esse rollback **não altera authority V2**, modo live do tenant, classificação, composição,
fallback, outbox, sender ou entrega. Ele nunca redireciona para V1. Se a captura estiver desligada
ou indisponível, a resposta segura determinada pelo pipeline continua normalmente.
