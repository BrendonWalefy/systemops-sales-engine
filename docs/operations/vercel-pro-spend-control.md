# Controle de spend da Vercel

O painel `Owner > Financeiro` separa mensalidade da Vercel e alertas de excedente recebidos pelo webhook de Spend Management.

## Configuração

1. definir `VERCEL_SPEND_WEBHOOK_SECRET` em produção;
2. definir `VERCEL_TEAM_ID` para rejeitar eventos de outra equipe;
3. habilitar thresholds no Spend Management;
4. apontar o webhook para `https://app.systemops.com.br/api/webhooks/vercel/spend`;
5. redeployar depois de trocar o secret;
6. testar assinatura, team ID e deduplicação.

O endpoint valida `x-vercel-signature` sobre o corpo bruto e persiste cada evento uma vez em `platform_spend_alerts`.

## Operação

- 50%: revisar tendência e principais recursos.
- 75%: investigar imediatamente e reduzir uso anormal.
- 100%: executar o runbook financeiro e decidir conscientemente sobre hard limit.

Não pause produção automaticamente por padrão: isso converte um incidente de custo em indisponibilidade do atendimento. O painel reflete o último threshold confirmado, não um medidor em tempo real.

Preço e franquias mudam; valide em [Vercel Pricing](https://vercel.com/pricing) antes de ajustar orçamento.
