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
| Vercel | Hobby (gratuito) | **R$ 0** | Dashboard Vercel: plano Hobby confirmado |
| Neon PostgreSQL | Free tier | **R$ 0** | Dashboard Neon: 0.03/0.5 GB, 16/100 CU-hrs |
| Vercel Blob | Free tier | **R$ 0** | Criado jun/2026, ~0 MB usado |
| Google Calendar API | Free | **R$ 0** | — |
| **Total** | | **~R$ 82,50/mês** | |

### Métricas de eficiência

| Métrica | Valor |
|---|---|
| Receita (plano Starter) | R$ 897,00/mês |
| Custo total infra | R$ 82,50/mês |
| **Margem bruta** | **91% (~R$ 814/mês)** |
| Custo por lead | R$ 2,29 |
| Custo por agendamento | R$ 6,87 |
| Custo OpenAI puro (IA) | $0.41 (~R$ 2,11) em 12 dias |

O Z-API representa **97% do custo total**. OpenAI é residual no volume atual.

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
- Vercel → Pro ($20/mês): quando adicionar domínio customizado ou precisar de CI avançado
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
- Vercel Hobby roda `message-worker`/`sender-worker` a cada minuto
  (`vercel.json`) — confirmar se o plano atual realmente sustenta essa frequência antes
  de escalar (Vercel historicamente restringe frequência de cron no tier gratuito;
  não temos essa confirmação registrada em produção ainda).
- Resto da infra tem folga grande: Neon Storage 2% usado, Network 4% usado. Z-API é
  custo fixo e linear por instância (~R$80/clínica/mês), já refletido na tabela abaixo.

## Projeção por Escala

| Clínicas | Z-API | OpenAI | Vercel/Neon | Total infra/mês | MRR mín. | Margem |
|---|---|---|---|---|---|---|
| 1 (hoje) | R$ 80 | R$ 3 | R$ 0 | **R$ 83** | R$ 897 | 91% |
| 5 | R$ 400 | R$ 15 | R$ 0 | **R$ 415** | R$ 4.485 | 91% |
| 15 | R$ 1.200 | R$ 45 | ~R$ 100 | **R$ 1.345** | R$ 13.455 | 90% |
| 30 | R$ 2.400 | R$ 90 | ~R$ 200 | **R$ 2.690** | R$ 26.910 | 90% |

Neon e Vercel só impactam margem a partir de ~15 clínicas ativas.

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
- Z-API é custo fixo por instância — migrar para Meta Cloud API avaliado quando ≥ 5 clínicas ou necessidade de botões nativos (ver `docs/architecture/media-infrastructure.md`).
