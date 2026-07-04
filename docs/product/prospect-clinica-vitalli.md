# Prospect — Clínica Vitalli (Dr. Victor Cavalcante)

**Data da reunião**: ~04/07/2026 (primeira apresentação do SystemOps a um prospect real).
**Resultado**: cliente gostou; reunião longa e sem roteiro — este doc organiza as
anotações e define a operação repetível de venda (apresentação → fechamento →
onboarding → experimento).

**Docs-irmãos**: `demo-roteiro-uau.md` (roteiro da demo), `levantamento-descoberta-cliente.md`
(questionário completo de onboarding), `pricing-strategy.md`, `estrategia-preenchimento-config.md`.

---

## 1. Anotações organizadas — o que o Victor pediu/revelou

### Perfil e volume
| Fato | Implicação |
|---|---|
| Foco em leads de campanhas Instagram/META | Caso de uso central do produto (canal `meta_ads`); é o mesmo perfil da Ximendes |
| **~1.000 mensagens/semana no WhatsApp** (~4.300/mês) | ~7x o volume do piloto Ximendes. Exige: **Neon Launch provisionado ANTES da ativação** (regra do cost-control), e enquadramento de plano: fair use do Growth (~800 conversas/mês) provavelmente estoura → **Scale (R$3.500)** ou fair use negociado. Validar com `especialista-infra` |
| "Plataforma como CRM parecido com o meu" | O inbox + funil + temperatura + follow-ups JÁ é o CRM. Na demo, mostrar o pipeline como CRM, não como "chat" |

### Agenda e agendamento
| Pedido | Status no produto |
|---|---|
| Trocar Google Calendar por **agenda interna** | ✅ Existe (calendário interno; ver `calendar-strategy.md`). Validar cobertura do fluxo completo dele |
| Consultas de **10 e 20 minutos** | Duração por tratamento — validar no SlotEngine/config de treatments |
| **Janela por procedimento** ("fecha lente 09:00 às 14:00") | ⚠️ A confirmar: janela de horário POR TRATAMENTO. Se não existir, é roadmap curto e vale para qualquer clínica de alta rotação |
| "Doutor deixa dias livres para fácil gestão" | Bloqueio de dias na agenda interna — validar UX de bloqueio |
| **Horário garantido só mediante comprovante do sinal** | ⚠️ Feature nova de alto valor: agendar → pedir sinal → confirmar ao receber comprovante (foto). Já temos precedente (sinal R$30 da Ximendes na política + `pipeline_photo_received`). Desenho: reserva provisória com TTL + operador valida comprovante + confirmação automática. NÃO deixar a IA "validar" comprovante sozinha |

### Marketing e recuperação
| Pedido | Status no produto |
|---|---|
| Lista de **leads frios + desconto em massa** | ✅ Base existe (`recovery-campaign`). O "desconto com validade" é a feature de **promoção com validade** (Fase 2 do plano de excelência). ⚠️ Compliance: broadcast em massa com limite/custo explícito (regra do cost-control) e risco de ban do WhatsApp — cadência controlada, nunca blast |
| **Qual anúncio performa melhor** (regiões, horários, faixa etária) | ⚠️ Parcial: hoje temos origem por canal. Atribuição POR ANÚNCIO exige capturar o `referral` do click-to-WhatsApp (ad_id) no webhook — roadmap de alto valor para todo cliente de tráfego pago. Demografia/região ficam no Ads Manager da Meta; nós cruzamos ad_id × conversões × horários |
| Periodicidade de marketing / conteúdo de mídia | Biblioteca de mídia ✅ + campanhas: definir calendário editorial no onboarding |
| "Quais semanas você vende mais ou menos?" (sazonalidade) | ⚠️ Parcial: métricas existem (`MetricsAggregator`, analytics); visão semanal comparativa é item de insights — fácil e vendedor |

## 2. Riscos/atenções antes de ativar a Vitalli

1. **Infra**: Neon Launch (US$19) antes do 1º pagante — 4.300 msgs/mês está muito acima
   do teto do free tier (~225 conversas/mês agregadas). Dono: `guardiao-operacional`.
2. **Plano**: volume dele não cabe no Start; provavelmente Scale. Fazer a conta de
   margem com voz (se Growth+B-WAVE) antes de prometer preço. Dono: `especialista-infra`.
3. **Conteúdo**: aplicar desde o dia 1 a `estrategia-preenchimento-config.md` — o
   questionário (`levantamento-descoberta-cliente.md`) preenche o playbook inicial; a
   caixa de perguntas/captura de correção mantém vivo.

## 3. A operação de venda repetível (o que faltou na reunião)

A reunião foi longa porque apresentação, discovery e onboarding viraram uma coisa só.
Separar em **4 atos com tempo fechado** — reunião de venda tem no máximo 1h:

### Ato 1 — Apresentação (30-40 min, roteirizada)
1. **Dor** (5 min): 2 perguntas — "quantos leads chegam fora do horário?" e "quanto
   tempo até responderem?" (ancora o problema em dinheiro perdido).
2. **Demo UAU** (10 min): exatamente `demo-roteiro-uau.md` — simulador ao vivo com os
   5 beats + bônus handoff. Fechar no dashboard (ROI 4,8x, leads fora do horário).
3. **Espelho** (10 min): "no seu caso..." — pegar 2-3 fatos do prospect (Instagram,
   1.000 msgs/semana, sinal) e mostrar onde o produto encaixa cada um.
4. **Oferta** (10 min): plano recomendado pelo volume + Oferta de Fundador (se couber)
   + próximo passo DATADO (kickoff de onboarding). Não detalhar configuração aqui.

**Regra**: perguntas de configuração ("qual horário de lente?") não pertencem à venda —
anotar e responder "isso a gente configura no onboarding, é rápido".

### Ato 2 — Fechamento (na reunião ou até 48h)
- Proposta gerada pelo **onboarding comercial guiado** (diagnóstico + ROI + proposta,
  já no produto) — enviar no mesmo dia.
- Condição de fechamento clara: contrato/sinal define a data do kickoff.

### Ato 3 — Onboarding (semana 1, reunião separada de 1h)
1. Questionário `levantamento-descoberta-cliente.md` (a parte que não coube na venda).
2. `create-clinic` + playbook v1 + conexão do número WhatsApp.
3. **O dono testa a própria IA no simulador** (o "uau" interno + treina a ferramenta —
   ataca a confusão que a Ximendes tem com as configurações).
4. Definir metas do experimento (Ato 4) por escrito.

### Ato 4 — Experimento (14-30 dias, com metas)
- KPIs combinados ANTES: 100% dos leads respondidos em <1 min; N agendamentos; % fora
  do horário recuperados; ROI no dashboard.
- Check-in semanal de 15 min (usa os insights do painel, não achismo).
- No fim: revisão de resultado → efetivação/upgrade + depoimento/case para a landing
  (`estrategista-gtm` transforma em prova social).

## 4. Próximos passos com a Vitalli

1. Enviar proposta (Ato 2) com plano dimensionado pelo volume real.
2. Validar tecnicamente: janela por procedimento, duração 10/20 min, bloqueio de dias,
   fluxo de sinal com comprovante — o que não existir vira roadmap priorizado por ele.
3. Provisionar Neon Launch antes do kickoff.
4. Roadmap de features puxadas por ele (ordem de valor): atribuição por anúncio (CTWA
   referral) → promoção com validade → sinal com comprovante → sazonalidade semanal.
