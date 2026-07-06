# Ficha de Setup da Clínica — receita de bolo do onboarding

Checklist objetivo para coletar do responsável da clínica **tudo que alimenta a
configuração** do SystemOps, sem o owner precisar deduzir. Duas partes:

1. **A ficha** — perguntas fechadas para enviar ao doutor (WhatsApp ou chamada
   de 20 min). Cada bloco diz onde a resposta entra no sistema.
2. **Evolução de produto** — como transformar isso em experiência guiada.

Complementa (não substitui) o diagnóstico comercial pré-venda
(`docs/product/levantamento-descoberta-cliente.md` e o onboarding comercial
guiado). Aqui é o setup **pós-fechamento**: a clínica já é cliente.

---

## Parte 1 — A ficha (enviar ao responsável)

> Formato sugerido: mandar bloco a bloco no WhatsApp, ou preencher junto numa
> chamada. Respostas curtas bastam; áudio vale — o owner estrutura depois.

### Bloco A — Identidade e tom (5 min)

| # | Pergunta | Onde entra |
|---|---|---|
| A1 | Nome exato da clínica como o paciente conhece (com acentos) | `organizations.name` — a IA fala esse nome |
| A2 | Nome da assistente virtual (ex.: "Gleice") e se apresenta como IA ou não | persona / mensagem de boas-vindas |
| A3 | Endereço completo + referência ("em cima da farmácia X") + estacionamento | FAQ da IA |
| A4 | Instagram e site oficiais | FAQ / validação de identidade |
| A5 | Tom: mais formal ("senhor/senhora") ou próximo ("você")? Emojis? | playbook / voz |

### Bloco B — Tratamentos e preços (15 min — o mais importante)

Para **cada** procedimento oferecido:

| # | Pergunta | Onde entra |
|---|---|---|
| B1 | Nome do procedimento + apelidos que o paciente usa ("lente", "lentes de resina") | `treatments.name` / `aliases` |
| B2 | **Duração real da sessão na cadeira** (não estimar — perguntar) | `durationMinutes` — errado aqui = agenda errada |
| B3 | Precisa de avaliação antes? A avaliação é paga? O valor abate do tratamento? | `requiresEvaluationFirst` / `priceDeductible` |
| B4 | Preço: valor fechado ou "a partir de"? Por dente/sessão/pacote? | `priceCents` / `priceKind` / `priceUnit` |
| B5 | A IA **pode falar o preço no chat**? (por procedimento, não geral) | `priceQuotableInChat` |
| B6 | Janela de horário específica? (ex.: lentes só 09h–14h) | janela por procedimento |
| B7 | Qual procedimento é o carro-chefe? (a IA prioriza na condução) | playbook / funil |

### Bloco C — Agenda e funcionamento (10 min)

| # | Pergunta | Onde entra |
|---|---|---|
| C1 | Dias e horários de atendimento (por dia da semana) | disponibilidade |
| C2 | Horário de almoço / bloqueios fixos | `calendar_blocks` |
| C3 | Quantos profissionais atendem e quem faz o quê | `professionals` |
| C4 | Antecedência mínima para agendar e para cancelar/remarcar | política de agenda |
| C5 | Encaixe no mesmo dia: aceita ou não? | política de agenda |
| C6 | Onde está a agenda hoje (papel, GCal, sistema)? Compromissos futuros já marcados? | migração para agenda interna |

### Bloco D — Dinheiro e efetivação (10 min)

| # | Pergunta | Onde entra |
|---|---|---|
| D1 | Formas de pagamento aceitas + parcelamento (máx. de parcelas, juros) | FAQ / `installmentRates` |
| D2 | Aceita convênio? Quais? Se não: como a IA responde a "aceita plano?" | FAQ — pergunta frequente nº 1 |
| D3 | Exige **sinal** para confirmar horário? Valor (fixo ou % do procedimento)? | política de efetivação |
| D4 | Chave Pix do sinal + nome que aparece no comprovante | script da IA no pedido de sinal |
| D5 | Quem valida o comprovante e em quanto tempo? O horário fica reservado enquanto isso? | processo (hoje humano via takeover) |
| D6 | Política de não comparecimento: perde o sinal? Remarca? | FAQ / política |

### Bloco E — Regras de conversa (5 min)

| # | Pergunta | Onde entra |
|---|---|---|
| E1 | 3 perguntas mais comuns dos pacientes (além de preço) | FAQ |
| E2 | O que a IA **nunca** deve prometer/falar (ex.: resultado clínico, desconto) | guardrails do playbook |
| E3 | Quando a IA deve passar para humano imediatamente (ex.: reclamação, urgência com dor) | regras de escalada |
| E4 | Quem da clínica responde pelo WhatsApp hoje (nome/número) — para o sistema reconhecer o operador | `receptionistPhone` / takeover |

### Bloco F — Canal e volume (já coletado no diagnóstico comercial; confirmar)

| # | Pergunta | Onde entra |
|---|---|---|
| F1 | De onde vêm os leads (anúncio Instagram/Meta, indicação, Google)? | atribuição / expectativa de volume |
| F2 | Quantas conversas novas por dia, em média? | caps / warmup do canal |
| F3 | O número do WhatsApp roda outra automação ou campanha em massa? (**tem que parar**) | channel safety |

---

## Parte 2 — Evolução de produto (para o owner parar de se sentir perdido)

### A visão que costura tudo: linha do tempo de implantação

As iniciativas de onboarding (diagnóstico comercial guiado, provisionamento
Z-API, pareamento no portal, shadow mode, estudo de setup/ADR-002) são etapas
de UMA jornada, mas hoje vivem em telas separadas. A peça de costura é uma
**linha do tempo de implantação** na página da clínica no owner:

> diagnóstico → fechado → canal conectado → shadow coletando (contador de
> conversas) → estudo gerado → aguardando validação do doutor → config
> aplicada → go-live

Cada etapa com estado e botão de ação. Princípio do lado do cliente: **o
doutor não configura, só corrige** — os únicos touchpoints dele são digitar o
código de pareamento e dar os checks no link de validação. O Setup Score
(item 1 abaixo) é a primeira versão disso; a timeline é a forma final.

Em ordem de esforço:

1. **Setup Score na página da clínica (P0)** — um bloco no owner que mostra o
   que está preenchido vs. faltando (tratamentos sem duração confirmada,
   FAQ vazio, agenda sem profissional, sinal sem chave Pix…), com link direto
   pro passo do wizard que resolve. O wizard de 7 passos já existe; falta o
   "mapa" do que está incompleto. É a resposta direta ao "me sinto perdido".
2. **Editar identidade da clínica no owner (P0, pequeno)** — hoje nome/slug só
   mudam por script (`scripts/rename-clinic.ts`). Adicionar campo de edição na
   página da clínica.
3. **Blueprint por segmento / clonar clínica (P1)** — "criar como a Ximendes":
   copiar tratamentos, FAQ base e playbook de uma clínica-modelo do mesmo
   segmento, e o owner só ajusta preços/horários. A Vitalli provou o caso de
   uso (mesmo segmento, mesma especialidade).
4. **Preenchimento assistido por IA (P1)** — o owner cola as respostas brutas
   da ficha (texto ou transcrição de áudio do doutor) e a LLM propõe a config
   estruturada (tratamentos com duração, FAQ, políticas) num diff que o owner
   revisa e aprova. Mantém a regra: **a LLM sugere, o owner decide** — nada
   entra em produção sem revisão humana.

### 4b. Estudo do shadow mode → documento de validação (P1 — decidido 06/07/2026)

Evolução do item 4 usando dados reais em vez de questionário. O shadow mode já
captura o atendimento humano completo (webhook com "notificar enviadas por mim"
grava as respostas do operador), e o cron `conversation-insights` já analisa
conversas por clínica. O fluxo:

1. **Estudo (batch)** — ao fim do período de shadow (~2 semanas), job minera as
   conversas e extrai candidatos a config com evidência: FAQ real (pergunta do
   lead → resposta do humano), preços verbalizados por procedimento, tom da
   recepção, políticas na prática (sinal, convênio, parcelas), horários
   oferecidos, gatilhos de escalada.
2. **Documento de validação** — página web mobile com link tokenizado para o
   responsável da clínica: 10–15 itens no formato "aprendemos que X →
   [✓ Confirmo] [✏️ Corrigir: ___]". Linguagem leiga, trechos **anonimizados**
   (LGPD — nunca citar paciente identificável).
3. **Aplicação** — respostas viram diff de config na página da clínica no
   owner; owner revisa e aplica. Nada muda sem confirmação humana.

Cuidado de design: resposta do atendente ≠ resposta desejada (a recepção pode
responder "errado") — o check do responsável é etapa obrigatória por isso.
Subproduto: comparar resposta da IA em shadow vs. humano na mesma conversa
alimenta o plano de excelência conversacional (gabarito real).

A ficha da Parte 1 vira o **fallback** para o que a conversa não revela
(duração na cadeira, bloqueios de agenda, chave Pix) — os dois se complementam.
5. **Fluxo de sinal nativo (P2, feature)** — hoje não existe: reserva
   provisória de slot com expiração (ex.: 2h aguardando comprovante),
   recepção do comprovante (imagem já chega pelo canal), validação humana em
   um clique e efetivação automática. Até lá, o processo é: IA conduz até o
   pedido do sinal → comprovante chega → `needsAttention` → humano valida e
   confirma. Documentar esse combinado com cada clínica que usa sinal.
