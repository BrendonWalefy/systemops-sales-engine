# Evidência de rejeição de contratos de IA

## Objetivo e limites

O runtime V2 registra evidência apenas quando uma saída textual do modelo é rejeitada pelo
contrato estrutural, semântico ou de verbalização. A trilha serve para explicar por que uma saída
foi recusada e melhorar contratos e prompts. Ela não decide respostas, não altera fallback, não
cria jobs ou outbounds e não autoriza entrega.

A listagem do owner mostra somente tenant, conversa, turno, estágio, códigos de violação,
modelo, tamanho, hash, estado de captura e horários. O conteúdo bruto só pode ser revelado
individualmente por uma sessão owner, dentro do tenant exato e antes da expiração. Cada acesso
bem-sucedido é auditado antes de o conteúdo ser devolvido. Logs, Sentry, Decision Trace e exports
não recebem prompt, saída rejeitada, telefone, nome, URL ou payload da mensagem.

## Chave e configuração

Crie uma chave dedicada com `openssl rand -hex 32` e publique-a somente no secret
`AI_EVIDENCE_ENCRYPTION_KEY` dos runtimes autorizados. A prontidão valida apenas presença e
formato de 64 caracteres hexadecimais; nunca imprima o valor. Não reutilize chave de sessão,
webhook, replay ou criptografia de configuração.

`AI_EVIDENCE_CAPTURE_ENABLED=true` habilita a composição do recorder. Valor ausente preserva o
default habilitado. `false`, valor vazio explícito no ambiente ou qualquer valor inválido impede
a composição de captura de modo fail-closed.

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

## Retenção e limpeza

- O conteúdo bruto criptografado e o digest da chave expiram em **7 dias**. A limpeza remove o
  envelope e marca a captura como expirada, preservando o diagnóstico metadata-only.
- Metadados da rejeição e auditorias de acesso expiram em **30 dias** e são removidos juntos.
- Cada operação processa no máximo 500 linhas e reutiliza o cron existente de limpeza. Não há
  polling, heartbeat, cron adicional ou worker contínuo.
- O purge de um tenant de teste cancelado remove primeiro auditorias e evidências daquele UUID;
  não alcança outro tenant.

Os contadores `aiContractRejectionRawExpired` e `aiContractRejectionMetadataDeleted` tornam cada
execução mensurável sem revelar conteúdo.

## Diagnóstico seguro

1. Localize o turno pelo `turnId`/`inboundEventId` e abra a trilha da conversa como owner.
2. Compare estágio, códigos fechados, modelo, tamanho, hash e estado de captura.
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
