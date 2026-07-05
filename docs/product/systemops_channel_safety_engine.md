# SystemOps - Channel Safety Engine / Communication Trust Engine

Documento de produto e arquitetura para governança de reputação de números e canais conversacionais.

## Conclusão principal

Trocar apenas o provider do mesmo número não esfria a reputação do número. O WhatsApp enxerga, principalmente, comportamento, dispositivo/sessao, feedback dos usuarios, denuncias, bloqueios, mensagens sem resposta, padroes de envio e reputação historica. O provider pode agravar o risco quando gera reconexoes, QR frequente, instabilidade ou comportamento anormal, mas não redefine a reputação.

O que esfria um número e reduzir comportamento suspeito e voltar a operar de forma conversacional: responder quem chamou, reduzir campanhas, reduzir contatos novos, aumentar intervalo entre mensagens, respeitar opt-in/opt-out, variar contexto, evitar links e permitir tempo de recuperacao.

## Recomendação de arquitetura

- Channel Safety Engine / Communication Trust Engine: motor de reputação, gates, score, warmup, cooling mode, políticas e alertas.
- Provider Router: roteamento por disponibilidade, custo, failover e estabilidade técnica. Não deve ser tratado como mecanismo de limpeza de reputação.
- Provedores baratos recomendados: Evolution API, WAHA, Z-API.
- Provedor oficial de referência: 360dialog.

## Principio comercial

O SystemOps não deve vender isso como anti-ban. Deve vender como governança de reputação, monitoramento preventivo, redução de risco e continuidade operacional.


## Referências
[1] WhatsApp Business Messaging Policy - https://whatsappbusiness.com/policy/
[2] Meta for Developers - Get opt-in for WhatsApp - https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in
[3] Meta for Developers - Pricing on the WhatsApp Business Platform - https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
[4] WhatsApp Business Platform Pricing - https://whatsappbusiness.com/products/platform-pricing/
[5] Meta for Developers - Messaging Limits - https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
[6] Meta for Developers - Template Quality Rating - https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-quality/
[7] Z-API - Blocks and Bans - https://developer.z-api.io/en/tips/blockednumber
[8] Z-API - Home / pricing references - https://z-api.io/
[9] Z-API - Mensageria Funcionando / calculator reference - https://z-api.io/mensageria-funcionando
[10] Evolution API GitHub - https://github.com/evolution-foundation/evolution-api
[11] WAHA GitHub - https://github.com/devlikeapro/waha
[12] WAHA Docs - How to avoid blocking - https://waha.devlike.pro/docs/overview/%EF%B8%8F-how-to-avoid-blocking/
[13] WPPConnect project - https://wppconnect-team.github.io/
[14] 360dialog Pricing - https://360dialog.com/pricing
[15] 360dialog WhatsApp API - https://360dialog.com/whatsapp-api
[16] Hostinger Evolution API VPS reference - https://www.hostinger.com/applications/evolution-api
[17] WAHA GitHub issue #1362 - https://github.com/devlikeapro/waha/issues/1362
[18] Reddit brdev automation on WhatsApp anecdotal report - https://www.reddit.com/r/brdev/comments/1mazl4r/automac%C3%A3o_no_whatsapp/
