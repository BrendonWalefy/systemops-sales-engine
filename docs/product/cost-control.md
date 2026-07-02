# Controle de Custos

Objetivo: medir custo variável por clínica sem depender de planilha ou estimativa manual.

---

## Custos Reais Auditados — Piloto Ximendes (jun/2026)

Auditoria realizada em 08/06/2026 com dados reais do painel de cada fornecedor.

### Resumo do piloto (27/05 → 08/06/2026 · 12 dias)

| Métrica | Valor |
|---|---|
| Leads | 36 |
| Conversas | 36 |
| Mensagens totais | 624 (326 do lead, 187 da IA) |
| Agendamentos | 12 |
| Áudios transcritos (Whisper) | 3 |
| Tamanho do banco (Neon) | 11 MB |

### Custo por serviço (mensal confirmado)

| Serviço | Plano | Custo/mês | Fonte |
|---|---|---|---|
| Z-API | "Meu número" — 1 instância | **R$ 79,99** | Fatura 24/05/2026 |
| OpenAI API | Pay-as-you-go (GPT-4o-mini + Whisper + TTS-1-HD) | **~R$ 2,50** | Dashboard OpenAI: $0.41 em jun/2026 |
| Vercel | Pro | **US$ 20 (~R$ 110,00)** | Dashboard Vercel: plano Pro confirmado (upgrade jul/2026); conversão aproximada, cotação R$ 5,50 |
| Neon PostgreSQL | Free tier | **R$ 0** | Dashboard Neon: 0.03/0.5 GB, 16/100 CU-hrs |
| Vercel Blob | Free tier | **R$ 0** | Criado jun/2026, ~0 MB usado |
| Google Calendar API | Free | **R$ 0** | — |
| **Total** | | **~R$ 192,50/mês** | |

### Métricas de eficiência

| Métrica | Valor |
|---|---|
| Receita (plano Start · preço vigente jul/2026) | R$ 1.300,00/mês |
| Custo total infra | R$ 192,50/mês |
| **Margem bruta** | **~85% (~R$ 1.107/mês)** |
| Custo por lead | R$ 2,29 |
| Custo por agendamento | R$ 6,87 |
| Custo OpenAI puro (IA) | $0.41 (~R$ 2,11) em 12 dias |

> O piloto Ximendes rodou no preço legado do Starter (R$897); a margem acima está
> recalculada no preço Start vigente (R$1.300) para servir de referência atual. O custo
> de infra (R$192,50) é real e independe do preço.

O Z-API representa **97% do custo total**. OpenAI é residual no volume atual.

---

## Tabela Mestre — Todos os Serviços Pagos e Drivers de Custo

Fonte única de custos da plataforma (mantida pelo agente `especialista-infra`; consumida
pelos preços em `docs/product/pricing-strategy.md`). "Driver" = o que faz o custo subir.

| Serviço | Modelo de cobrança | Custo atual | Driver de custo |
|---|---|---|---|
| Z-API | R$79,99 / instância (1 número) | R$79,99/clínica | nº de números conectados — linear por clínica |
| OpenAI (GPT-4o-mini + Whisper + TTS-1-HD) | pay-as-you-go por token/áudio | ~R$3/mês (piloto) | volume de conversas × tamanho do histórico; áudios transcritos |
| **ElevenLabs / B-WAVE** | por crédito; **Flash v2.5 ≈ 0,5 crédito/char** | **~$0,12/1k chars no Pro** (~R$0,66) | modo de voz (`impact` < `mix` < `full`) × volume falado. Plano: Pro $99/600k créditos → Scale $299/1,8M. Maior driver variável do Growth. |
| Vercel | Pro flat US$20/mês | ~R$110/mês (conta toda) | bandwidth/execução; serverless escala — sem gatilho de troca no horizonte |
| Vercel Blob | Free (1GB / 5GB egress) → pago | R$0 hoje | mídia armazenada (TTL de 90 dias segura o crescimento) |
| Neon PostgreSQL | Free (100 CU-hrs) → Launch US$19+ | R$0 hoje → **provisionar Launch antes do 1º cliente pago** | CU-hrs (compute) ≈ 0,44/conversa; storage |
| **Resend** | Free (3k e-mails/mês, 100/dia) → Pro US$20 | R$0 hoje | e-mails transacionais + digest diário × nº de clínicas |
| Google Calendar API | Free | R$0 | — (opt-in por clínica) |
| Web Push (VAPID) | nativo do browser | R$0 | — |
| Domínio / DNS | anual | ~R$40/ano | fixo |

Estimativas de ElevenLabs e Resend a validar com uso real dos primeiros clientes Growth —
padrão do doc: extrapolação de amostra pequena, confirmar em produção.

### Margem por plano nos preços vigentes (jul/2026)

Preços: **Start R$1.300 / Growth R$2.100 / Scale R$3.500** (ver `pricing-strategy.md`).

- **Start (R$1.300)** — voz OpenAI, default **`greeting_only`** (só a saudação; decisão
  jul/2026 por feedback da Ximendes de que áudio em excesso incomoda). Custo de infra de
  clínica pequena ~R$83-200/mês → margem **~85-94%**. Saudável.
- **Growth (R$2.100)** — B-WAVE em default **`impact`** (não `full`); `full` é opt-in.
  Tabela de margem abaixo.
- **Scale (R$3.500)** — B-WAVE em `mix` + ticket maior → margem **~83%+**.

#### Margem do Growth por modo × volume × preço do ElevenLabs

Premissas: ~5 mensagens de IA/conversa (piloto real), ~180 chars/mensagem falada; típico
= 350 conversas/mês, alto = 800 (teto de fair use). ElevenLabs: **conservador** = $0,30/1k
(overage Creator, 1 crédito/char) vs **realista** = ~$0,12/1k (Flash v2.5 no Pro). Outros
custos do Growth ~R$140 (Z-API + OpenAI + Vercel/Neon; cai p/ ~R$90 com Evolution API).

| Modo · volume · preço | Custo voz/mês | Margem Growth |
|---|---|---|
| `full` · típico · realista | ~R$158 | ~86% |
| `full` · típico · conservador | ~R$433 | ~73% |
| `full` · **alto · conservador** | ~R$990 | **~46%** ⚠️ |
| `full` · alto · realista | ~R$360 | ~76% |
| **`impact` · alto · conservador** | ~R$594 | **~65%** |
| `impact` · alto · realista | ~R$216 | ~83% |

Leitura: o único cenário ruim (46%) é `full` + alto volume + plano/modelo errado no
ElevenLabs — exatamente a clínica que o Growth mira. Default `impact` + Pro/Flash elimina
o risco (pior caso sobe para ~83%). **Acompanhar `tts_usage_costs` nos primeiros Growth.**

**Regra:** nunca prometer feature de custo variável (voz premium) sem margem confirmada
no plano em que ela é vendida.

---

## Limites dos Planos Gratuitos

Estes limites devem ser monitorados antes de fazer upgrade:

| Serviço | Limite Free | Uso atual | Margem |
|---|---|---|---|
| Neon — Storage | 512 MB | 11 MB (2%) | ~490 MB livres |
| Neon — Compute | 100 CU-hrs/mês | 16 CU-hrs (16%) | ~84 CU-hrs |
| Neon — Network | 5 GB | 0.2 GB (4%) | ~4.8 GB |
| Vercel — Bandwidth | 100 GB | — | Monitorar ao escalar |
| Vercel Blob | 1 GB / 5 GB egress | ~0 | — |

**Trigger de upgrade:**
- Neon → Launch ($19/mês): quando Compute > 80 CU-hrs ou Storage > 400 MB
- Vercel → Pro ($20/mês): ✅ já migrado (jul/2026)
- Z-API → plano superior: avaliar ao escalar acima de 10 instâncias simultâneas

---

## Capacidade Real de Conversas — Infra Atual (jul/2026)

Cálculo derivado do piloto Ximendes: 36 conversas consumiram 16 de 100 CU-hrs/mês do
Neon Free tier em 12 dias → **≈ 0,44 CU-hr por conversa**.

Extrapolando para o teto do Neon Free (100 CU-hrs/mês):

**≈ 225 conversas/mês é o teto real da infra atual, agregando TODAS as clínicas juntas**
— não é por clínica. É uma extrapolação de amostra pequena (36 conversas), a validar
com uso real dos primeiros clientes pagantes.

Implicação direta para os planos comerciais (`docs/product/pricing-strategy.md`):
- 1 cliente Growth sozinho (fair use ~800 conversas/mês) já ultrapassa esse teto em
  ~3-4x.
- 1 cliente Start sozinho (fair use ~300 conversas/mês) já ultrapassa o teto.
- A tabela de "Projeção por Escala" abaixo (gatilho de upgrade do Neon "a partir de 15
  clínicas") estava otimista demais — foi calculada por custo médio por clínica, não
  pelo teto de CU-hrs do tier gratuito. **Correção: provisionar Neon Launch (US$19/mês)
  antes de ativar o primeiro cliente pago**, não esperar volume.
- Vercel Pro roda `message-worker`/`sender-worker` a cada minuto (`vercel.json`) —
  plano Pro suporta crons sub-diários nativamente, sem a restrição que existia no
  tier gratuito.
- Resto da infra tem folga grande: Neon Storage 2% usado, Network 4% usado. Z-API é
  custo fixo e linear por instância (~R$80/clínica/mês), já refletido na tabela abaixo.

## Projeção por Escala

| Clínicas | Z-API | OpenAI | Vercel/Neon | Total infra/mês | MRR mín. | Margem |
|---|---|---|---|---|---|---|
| 1 (hoje) | R$ 80 | R$ 3 | R$ 0 | **R$ 83** | R$ 1.300 | 94% |
| 5 | R$ 400 | R$ 15 | R$ 0 | **R$ 415** | R$ 6.500 | 94% |
| 15 | R$ 1.200 | R$ 45 | ~R$ 100 | **R$ 1.345** | R$ 19.500 | 93% |
| 30 | R$ 2.400 | R$ 90 | ~R$ 200 | **R$ 2.690** | R$ 39.000 | 93% |

Neon e Vercel só impactam margem a partir de ~15 clínicas ativas. **MRR mín.** usa o piso
Start (R$1.300/clínica); com mix de Growth (R$2.100) a margem sobe. Custo Z-API mostrado é
o pior caso (1 instância paga por clínica) — a partir da 2ª clínica ele cai muito migrando
para Evolution API self-hosted (ver `docs/operations/infra-scaling-thresholds.md`). ElevenLabs
não entra aqui (Start usa voz OpenAI); para clínicas Growth, somar o driver de voz premium
da Tabela Mestre acima.

---

## Custos Monitorados no Banco

### IA
Tabela: `ai_usage_costs`
- modelo, operação, input/output tokens, custo estimado em microdólares, clínica

### WhatsApp
Tabela: `whatsapp_message_costs`
- clínica, direção, categoria, custo estimado

### Dashboard
Disponível em `/owner/financeiro` — MRR, margem bruta, custo por clínica, benchmark do piloto.

---

## Regras de Produto

- Custos visíveis para o owner antes de escalar para mais clínicas.
- Ambientes de QA desligam envio real (`DISABLE_REAL_WHATSAPP_SEND=true`) e LLM real (`DISABLE_REAL_OPENAI=true`).
- Campanhas outbound não ativadas sem controle explícito de limite e custo.
- Playbooks não podem burlar limite financeiro; limites estão em código ou configuração determinística.
- Z-API é custo fixo por instância. A partir da **2ª clínica**, avaliar migração para
  Evolution API self-hosted (Hetzner) — break-even imediato; gatilhos e trade-offs em
  `docs/operations/infra-scaling-thresholds.md`. Meta Cloud API / botões nativos: ver
  `docs/architecture/media-infrastructure.md`.
