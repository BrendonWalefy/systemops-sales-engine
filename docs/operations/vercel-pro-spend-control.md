# Vercel Pro Spend Control

## O que o painel mede

O painel `Owner > Financeiro` separa dois custos:

- mensalidade Pro: custo fixo de US$20, convertido pela cotacao centralizada no codigo;
- excedente: ultimo valor confirmado pelo webhook de Spend Management da Vercel no mes corrente.

O Spend Management mede apenas recursos faturaveis alem dos creditos e franquias
do plano. Ele nao inclui a mensalidade Pro, seats adicionais ou add-ons. Por
isso o custo base sempre aparece no painel, mesmo sem nenhum alerta recebido.

## Configuracao obrigatoria apos assinar o Pro

1. Deployar a migration `0039_faithful_korg.sql` antes do codigo que recebe o webhook.
2. Criar `VERCEL_SPEND_WEBHOOK_SECRET` no ambiente de producao com o secret exibido pela Vercel ao salvar o webhook.
3. Criar `VERCEL_TEAM_ID` com o ID da equipe Vercel para rejeitar eventos de outra equipe.
4. Em Vercel Team Settings > Billing > Spend Management, habilitar notificacoes de 50%, 75% e 100%.
5. Configurar o webhook para `https://app.systemops.com.br/api/webhooks/vercel/spend`.
6. Configurar um teto inicial pequeno de excedente, por exemplo US$5, enquanto o produto ainda nao tiver cinco clinicas pagantes.

Importante: ao salvar um webhook novo ou recriar o existente, a Vercel emite um
novo secret e nao o mostra novamente. Sempre sincronize esse valor em
`VERCEL_SPEND_WEBHOOK_SECRET` e rode um redeploy de producao antes de considerar
o webhook ativo.

Nao habilitar `Pause production deployment` por padrao: ao atingir o teto, a
Vercel responde `503 DEPLOYMENT_PAUSED` para pacientes e clinicas. Use essa
acao somente se o procedimento operacional aceitar indisponibilidade em troca
de um limite rigido de gasto.

## Seguranca e operacao

O endpoint exige HMAC-SHA1 em `x-vercel-signature`, calculado com o corpo bruto
da requisicao e `VERCEL_SPEND_WEBHOOK_SECRET`. Eventos repetidos sao deduplicados
pelo hash do payload.

Quando receber 75% ou 100%, investigar imediatamente o dashboard Vercel e a
linha Vercel no Financeiro. O valor no painel e o ultimo alerta confirmado,
nao um medidor em tempo real entre dois thresholds.
