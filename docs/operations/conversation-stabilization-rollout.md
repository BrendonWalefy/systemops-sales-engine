# Rollout de estabilização conversacional

Este pacote muda código, schema e configuração por tenant. Produção não deve
receber as etapas abaixo fora desta ordem.

## Pré-condições

1. `npm run verify` e CI verdes no commit exato do deploy.
2. Backup/branch isolado do banco criado a partir da produção.
3. Migration `0092_decision_traces.sql` aplicada primeiro no banco isolado.
4. Dataset sanitizado, revisado e assinado novamente depois de toda alteração
   de playbook, tratamento, alias, mídia ou pipeline.
5. Nenhum replay pode apontar para o host do banco de produção.

## Migrações de configuração

### Escopo desta promoção

Nesta promoção, aplique configuração **somente para a Ximendes**. Vitalli está
cancelada e NC Beauty ainda será configurada em uma rodada própria; portanto,
não execute planos de configuração dessas clínicas em produção.

Execute primeiro sem `--apply`, confira os digests e só depois aplique no banco
isolado:

```bash
tsx scripts/migrate-treatment-pipeline-families.ts --clinic=ximendes --entry=legacy --presentation=preserve
tsx scripts/migrate-ximendes-playbook-pipeline-ownership.ts
```

As mesmas chamadas com `--apply` consolidam os pipelines, preservam byte a byte
o bloco de apresentação da Ximendes (`vídeo`, `vídeo`, `preços`) e removem
trigger, preço e apresentação/persona redundantes das instruções secundárias.

Depois, rode o auditor para a Ximendes. Ela não pode manter achados ativos
P0/P1/P2. As demais clínicas permanecem inalteradas e fora deste go-live.

## Gate de replay

Para a Ximendes, gere novo fingerprint, reemita o dataset preservando o digest
das conversas e assine-o novamente. Rode:

- corpus distribuído completo em `closed_loop`;
- cenários com rajada em `concurrency`;
- três repetições dos cenários críticos;
- contratos específicos de seleção de variante e sequência de mídia;
- revisão humana das transcrições.

Checks determinísticos e achados automáticos `high`/`medium` devem ser zero. O
score operacional não substitui a revisão humana de tom, coerência comercial e
qualidade clínica.

## Ativação e rollback

1. Promova o código para `develop`; faça QA manual e aguarde CI.
2. Aplique as mesmas migrações, com os mesmos digests, em produção.
3. Ative uma clínica por vez e acompanhe Decision Trace, filas, silêncios e
   duplicidades durante a janela de observação.
4. NC Beauty só sai de `test`/shadow depois do gate completo e da aprovação do
   dono. Vitalli permanece pausada até uma decisão comercial explícita.

Rollback de famílias usa `--rollback` no script de pipelines. O playbook da
Ximendes e a limpeza de mídia também aceitam `--rollback`, reativando a versão
histórica anterior. Em falha de código, mantenha a automação do tenant desligada
e reverta o commit pelo fluxo normal; nunca empilhe uma correção improvisada.
